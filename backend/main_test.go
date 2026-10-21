package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func testData() GameData {
	return GameData{Config: Config{CollectMs: 30000, BattleMs: 90000, BaseHP: 1200, TickMs: 20, SpawnMin: 380, SpawnMax: 780, VisibleMin: 400, VisibleMax: 900, Bushes: 6, Width: 1200, Bases: [2]float64{85, 1115}, SummonCooldown: 180, DisconnectMs: 15000}, Dinos: []Dino{{ID: "tyranno", Name: "티라노", HP: 200, Attack: 50, Interval: 500, Speed: 100, Range: 40, Weight: 1}, {ID: "brachio", Name: "브라키오", HP: 400, Attack: 30, Interval: 900, Speed: 60, Range: 90, Weight: 2}}}
}

func testClient(h *Hub) *Client {
	return &Client{hub: h, send: make(chan []byte, 4096), done: make(chan struct{}), side: -1, replies: map[string][]byte{}}
}

func perform(t *testing.T, h *Hub, c *Client, req Request, now int64) Ack {
	t.Helper()
	h.handle(c, req, now)
	for {
		select {
		case b := <-c.send:
			var ack Ack
			_ = json.Unmarshal(b, &ack)
			if ack.Event == "ack" && ack.RequestID == req.RequestID {
				return ack
			}
		default:
			t.Fatalf("no acknowledgement for %s", req.Event)
			return Ack{}
		}
	}
}

func testRoom(t *testing.T) (*Hub, *Room, *Client, *Client) {
	t.Helper()
	h := newHub(testData())
	a, b := testClient(h), testClient(h)
	if ack := perform(t, h, a, Request{Event: "create", RequestID: "create-a", Name: "왼쪽"}, 100000); !ack.OK {
		t.Fatal(ack.Error)
	}
	room := a.room
	if ack := perform(t, h, b, Request{Event: "join", RequestID: "join-b", Code: room.Code, Name: "오른쪽"}, 100000); !ack.OK {
		t.Fatal(ack.Error)
	}
	return h, room, a, b
}

func TestRoomCapacityAndReady(t *testing.T) {
	h, r, a, b := testRoom(t)
	third := testClient(h)
	if ack := perform(t, h, third, Request{Event: "join", RequestID: "third", Code: r.Code}, 100000); ack.OK {
		t.Fatal("third player joined")
	}
	if ack := perform(t, h, a, Request{Event: "ready", RequestID: "ready-a"}, 100000); !ack.OK {
		t.Fatal(ack.Error)
	}
	if r.Phase != "lobby" {
		t.Fatal("started with only one ready player")
	}
	perform(t, h, b, Request{Event: "ready", RequestID: "ready-b"}, 100001)
	if r.Phase != "collect" || r.EndsAt != 130001 {
		t.Fatalf("phase=%s end=%d", r.Phase, r.EndsAt)
	}
	if ack := perform(t, h, third, Request{Event: "join", RequestID: "late", Code: r.Code}, 100002); ack.OK {
		t.Fatal("late join accepted")
	}
}

func TestCollectionOwnershipExpiryDedupAndPrivacy(t *testing.T) {
	h, r, a, b := testRoom(t)
	h.startCollection(r, 100000)
	r.Players[0].Spawns["own"] = Spawn{ID: "own", Type: "tyranno", Bush: 0, ExpiresAt: 101000}
	r.Players[1].Spawns["enemy"] = Spawn{ID: "enemy", Type: "brachio", Bush: 1, ExpiresAt: 101000}
	if ack := perform(t, h, a, Request{Event: "collect", RequestID: "steal", ID: "enemy"}, 100100); ack.OK {
		t.Fatal("collected opponent spawn")
	}
	req := Request{Event: "collect", RequestID: "collect-once", ID: "own"}
	if !perform(t, h, a, req, 100200).OK || !perform(t, h, a, req, 100201).OK {
		t.Fatal("request replay should return original successful ack")
	}
	if r.Players[0].Inventory["tyranno"] != 1 {
		t.Fatal("replayed collect changed inventory")
	}
	if ack := perform(t, h, a, Request{Event: "collect", RequestID: "duplicate-id", ID: "own"}, 100202); ack.OK {
		t.Fatal("spawn collected twice")
	}
	if ack := perform(t, h, b, Request{Event: "collect", RequestID: "expired", ID: "enemy"}, 101000); ack.OK {
		t.Fatal("expired spawn collected")
	}
	r.Players[0].Spawns["secret"] = Spawn{ID: "secret", Type: "tyranno", Bush: 2, ExpiresAt: 102000}
	if len(h.snapshot(r, 1, 101100).Spawns) != 0 {
		t.Fatal("opponent can see private spawns")
	}
	if len(h.snapshot(r, 0, 101100).Spawns) != 1 {
		t.Fatal("owner cannot see own spawn")
	}
}

func TestSpawnTimingAndAutomaticTransition(t *testing.T) {
	h, r, _, _ := testRoom(t)
	h.startCollection(r, 100000)
	h.step(r, 100200)
	for _, p := range r.Players {
		if len(p.Spawns) != 1 {
			t.Fatal("each player should receive their own spawn")
		}
		for _, s := range p.Spawns {
			if s.ExpiresAt < 100600 || s.ExpiresAt > 101100 || s.Bush < 0 || s.Bush >= 6 {
				t.Fatalf("invalid spawn: %+v", s)
			}
		}
	}
	r.Players[0].Inventory["tyranno"] = 3
	h.step(r, 130000)
	if r.Phase != "battle" || r.EndsAt != 220000 || len(r.Players[0].Spawns) != 0 || r.Players[0].Inventory["tyranno"] != 3 {
		t.Fatal("collection transition lost inventory or timer")
	}
}

func TestSummonServerInventoryCooldownAndReplay(t *testing.T) {
	h, r, a, b := testRoom(t)
	r.Phase = "battle"
	r.EndsAt = 200000
	r.Players[0].Inventory["tyranno"] = 2
	r.Players[1].Inventory["brachio"] = 1
	req := Request{Event: "summon", RequestID: "summon-one", Type: "tyranno"}
	if !perform(t, h, a, req, 100000).OK || !perform(t, h, a, req, 100001).OK {
		t.Fatal("summon replay failed")
	}
	if len(r.Units) != 1 || r.Players[0].Inventory["tyranno"] != 1 {
		t.Fatal("replayed summon consumed a second dinosaur")
	}
	if ack := perform(t, h, a, Request{Event: "summon", RequestID: "too-fast", Type: "tyranno"}, 100100); ack.OK {
		t.Fatal("cooldown ignored")
	}
	if ack := perform(t, h, a, Request{Event: "summon", RequestID: "again", Type: "tyranno"}, 100180); !ack.OK {
		t.Fatal(ack.Error)
	}
	if ack := perform(t, h, a, Request{Event: "summon", RequestID: "empty", Type: "tyranno"}, 100400); ack.OK {
		t.Fatal("summoned from empty inventory")
	}
	if !perform(t, h, b, Request{Event: "summon", RequestID: "right", Type: "brachio"}, 100400).OK {
		t.Fatal("right side summon failed")
	}
	if r.Units[0].X != 130 || r.Units[2].X != 1070 || r.Units[2].Side != 1 {
		t.Fatal("spawn coordinates or sides are incorrect")
	}
}

func TestSimultaneousCombatAndNoCrossing(t *testing.T) {
	h, r, _, _ := testRoom(t)
	r.Phase = "battle"
	r.EndsAt = 200000
	r.LastTick = 100000
	r.Units = []*Unit{{ID: "a", Type: "tyranno", Side: 0, X: 580, HP: 50}, {ID: "b", Type: "tyranno", Side: 1, X: 620, HP: 50}}
	h.combat(r, 100050)
	if len(r.Units) != 0 {
		t.Fatal("damage must resolve simultaneously even if both attackers die")
	}
	r.Units = []*Unit{{ID: "c", Type: "tyranno", Side: 0, X: 500, HP: 200}, {ID: "d", Type: "tyranno", Side: 1, X: 700, HP: 200}}
	for now := int64(100050); now < 103000; now += 50 {
		h.step(r, now)
		if len(r.Units) == 2 && r.Units[0].X > r.Units[1].X {
			t.Fatal("opponents passed through one another")
		}
	}
}

func TestBaseDestructionExtinctionAndTimeout(t *testing.T) {
	h, r, _, _ := testRoom(t)
	r.Phase = "battle"
	r.EndsAt = 200000
	r.LastTick = 100000
	r.HP = [2]int{1200, 40}
	r.Players[1].Inventory["brachio"] = 3
	r.Units = []*Unit{{ID: "attacker", Type: "tyranno", Side: 0, X: 1080, HP: 200}}
	h.step(r, 100050)
	if r.Phase != "result" || r.Winner == nil || *r.Winner != 0 || r.HP[1] != 0 || r.Reason != "destruction" || r.Players[1].Inventory["brachio"] != 0 {
		t.Fatal("destruction result or loser extinction incorrect")
	}
	for _, tc := range []struct {
		hp     [2]int
		winner int
	}{{[2]int{900, 500}, 0}, {[2]int{200, 500}, 1}, {[2]int{500, 500}, -1}} {
		h, r, _, _ = testRoom(t)
		r.Phase = "battle"
		r.EndsAt = 100010
		r.HP = tc.hp
		h.step(r, 100010)
		if r.Phase != "result" || r.Reason != "time" {
			t.Fatal("timeout not finalized")
		}
		if tc.winner == -1 {
			if r.Winner != nil {
				t.Fatal("equal base health must draw")
			}
		} else if r.Winner == nil || *r.Winner != tc.winner {
			t.Fatal("wrong timeout winner")
		}
	}
}

func TestResumeAndDisconnectForfeit(t *testing.T) {
	h, r, a, _ := testRoom(t)
	h.startCollection(r, 100000)
	token := r.Players[0].Token
	r.Players[0].Inventory["tyranno"] = 2
	h.disconnect(a, 100100)
	replacement := testClient(h)
	if ack := perform(t, h, replacement, Request{Event: "resume", RequestID: "resume", Token: token, Code: r.Code}, 110000); !ack.OK {
		t.Fatal(ack.Error)
	}
	if r.Players[0].Client != replacement || r.Players[0].Inventory["tyranno"] != 2 {
		t.Fatal("resume did not preserve player")
	}
	h.disconnect(a, 110010)
	if r.Players[0].Client != replacement {
		t.Fatal("stale connection disconnected replacement")
	}
	h.disconnect(replacement, 110100)
	h.step(r, 125100)
	if r.Phase != "result" || r.Winner == nil || *r.Winner != 1 || r.Reason != "disconnect" {
		t.Fatal("disconnect grace did not end in forfeit")
	}
}

func TestInvalidRequestsAndReconnectDedup(t *testing.T) {
	h, r, a, _ := testRoom(t)
	r.Phase = "battle"
	r.EndsAt = 200000
	r.Players[0].Inventory["tyranno"] = 2
	if ack := perform(t, h, a, Request{Event: "summon", Type: "tyranno"}, 100000); ack.OK {
		t.Fatal("missing request id accepted")
	}
	request := Request{Event: "summon", RequestID: "original-summon", Type: "tyranno"}
	if !perform(t, h, a, request, 100001).OK {
		t.Fatal("initial summon failed")
	}
	token := r.Players[0].Token
	replacement := testClient(h)
	if ack := perform(t, h, replacement, Request{Event: "resume", RequestID: "resume-active", Token: token}, 100002); !ack.OK {
		t.Fatal(ack.Error)
	}
	select {
	case <-a.done:
	default:
		t.Fatal("old socket remained active after session takeover")
	}
	if !perform(t, h, replacement, request, 100500).OK {
		t.Fatal("reconnect could not replay acknowledgement")
	}
	if len(r.Units) != 1 || r.Players[0].Inventory["tyranno"] != 1 {
		t.Fatal("reconnect replay consumed inventory twice")
	}
	h.handle(a, Request{Event: "summon", RequestID: "old-client", Type: "tyranno"}, 100501)
	if len(r.Units) != 1 || a.room != nil {
		t.Fatal("displaced connection retained player access")
	}
	if ack := perform(t, h, replacement, Request{Event: "summon", RequestID: "invalid-type", Type: "not-real"}, 100502); ack.OK {
		t.Fatal("unknown dinosaur accepted")
	}
}

func TestLoadActualGameData(t *testing.T) {
	data, err := loadData("../public/game-data.json")
	if err != nil {
		t.Fatal(err)
	}
	if len(data.Dinos) != 30 {
		t.Fatalf("expected30 supplied dinosaurs, got%d", len(data.Dinos))
	}
	if data.Config.CollectMs != 30000 || data.Config.BattleMs != 90000 {
		t.Fatal("production timers must retain requested30/90seconds")
	}
	roles := map[string]int{}
	for _, d := range data.Dinos {
		roles[d.Class]++
		if d.RoleLabel == "" {
			t.Fatalf("missing role label for %s", d.ID)
		}
	}
	for class, count := range map[string]int{"tank": 10, "assault": 7, "skirmisher": 8, "flying": 5} {
		if roles[class] != count {
			t.Fatalf("class %s: expected %d dinosaurs, got %d", class, count, roles[class])
		}
	}
}

func TestFlyingSharesCombatLineAndPublishesAttackTime(t *testing.T) {
	data, err := loadData("../public/game-data.json")
	if err != nil {
		t.Fatal(err)
	}
	h := newHub(data)
	r := &Room{Phase: "battle", HP: [2]int{1200, 1200}, LastTick: 100000, Units: []*Unit{
		{ID: "flyer", Type: "pteranodon", Side: 0, X: 580, HP: h.dinos["pteranodon"].HP},
		{ID: "tank", Type: "tricera", Side: 1, X: 620, HP: h.dinos["tricera"].HP},
	}}
	h.combat(r, 100050)
	if len(r.Units) != 2 || r.Units[0].HP != h.dinos["pteranodon"].HP-h.dinos["tricera"].Attack || r.Units[1].HP != h.dinos["tricera"].HP-h.dinos["pteranodon"].Attack {
		t.Fatal("both ground and flying units must be able to attack each other")
	}
	b, err := json.Marshal(h.snapshot(r, 0, 100050))
	if err != nil {
		t.Fatal(err)
	}
	var view struct {
		Units []struct {
			AttackAt int64 `json:"attackAt"`
		} `json:"units"`
	}
	if err := json.Unmarshal(b, &view); err != nil {
		t.Fatal(err)
	}
	if len(view.Units) != 2 || view.Units[0].AttackAt != 100050 || view.Units[1].AttackAt != 100050 {
		t.Fatal("both browsers need the same server attack timestamp for animation")
	}
}

func TestLeaveAfterBattleDeadlinePreservesTimeoutResult(t *testing.T) {
	for _, tc := range []struct {
		name   string
		hp     [2]int
		winner int
	}{{"win", [2]int{900, 500}, 0}, {"draw", [2]int{500, 500}, -1}} {
		t.Run(tc.name, func(t *testing.T) {
			h, r, a, _ := testRoom(t)
			r.Phase, r.EndsAt, r.HP = "battle", 100010, tc.hp
			if ack := perform(t, h, a, Request{Event: "leave", RequestID: "leave-at-deadline"}, 100010); !ack.OK {
				t.Fatal(ack.Error)
			}
			if r.Phase != "result" || r.Reason != "time" {
				t.Fatal("leave after the timer ended overwrote timeout with forfeit")
			}
			if tc.winner < 0 {
				if r.Winner != nil {
					t.Fatal("leaving after a timed draw changed its outcome")
				}
			} else if r.Winner == nil || *r.Winner != tc.winner {
				t.Fatal("leaving after a timed win changed its winner")
			}
		})
	}
}

func TestLobbyExpiryAndLeave(t *testing.T) {
	h, r, a, b := testRoom(t)
	h.disconnect(a, 100000)
	h.step(r, 115000)
	if r.Players[0] != nil {
		t.Fatal("disconnected lobby seat was not reclaimed")
	}
	if !perform(t, h, b, Request{Event: "leave", RequestID: "leave"}, 115001).OK {
		t.Fatal("leave failed")
	}
	if len(h.rooms) != 0 || len(h.sessions) != 0 {
		t.Fatal("empty room leaked")
	}
}

func TestResultKeepsNamesWhenOpponentLeaves(t *testing.T) {
	h, r, a, b := testRoom(t)
	r.Phase = "battle"
	r.EndsAt = 200000
	if !perform(t, h, a, Request{Event: "leave", RequestID: "forfeit"}, 100001).OK {
		t.Fatal("forfeit failed")
	}
	if r.Phase != "result" || r.Players[0] == nil || r.Players[0].Name != "왼쪽" || r.Players[0].Client != nil || !r.Players[0].Left {
		t.Fatal("result lost opponent history")
	}
	if len(h.rooms) != 1 || len(h.sessions) != 1 {
		t.Fatal("remaining player lost room or leaving session retained")
	}
	if !perform(t, h, b, Request{Event: "leave", RequestID: "close-result"}, 100002).OK {
		t.Fatal("result leave failed")
	}
	if len(h.rooms) != 0 || len(h.sessions) != 0 {
		t.Fatal("result room leaked after both players left")
	}
}

func TestOriginAndHealth(t *testing.T) {
	h := newHub(testData())
	server := httptest.NewServer(h.handler(t.TempDir()))
	defer server.Close()
	response, err := http.Get(server.URL + "/healthz")
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		t.Fatal("health endpoint unavailable")
	}
	header := http.Header{}
	header.Set("Origin", "https://untrusted.example")
	conn, response, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http")+"/ws", header)
	if err == nil {
		_ = conn.Close()
		t.Fatal("untrusted websocket origin accepted")
	}
	if response == nil || response.StatusCode != 403 {
		t.Fatal("origin should receive403")
	}
}

func TestBuiltFrontendAndSPAFallback(t *testing.T) {
	frontend := t.TempDir()
	if err := os.WriteFile(filepath.Join(frontend, "index.html"), []byte("<!doctype html><title>Dino battle</title>"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(frontend, "game-data.json"), []byte(`{"dinos":[]}`), 0600); err != nil {
		t.Fatal(err)
	}
	h := newHub(testData())
	server := httptest.NewServer(h.handler(frontend))
	defer server.Close()
	for _, path := range []string{"/", "/game-data.json", "/room/ABC123"} {
		response, err := http.Get(server.URL + path)
		if err != nil {
			t.Fatal(err)
		}
		_ = response.Body.Close()
		if response.StatusCode != 200 {
			t.Fatalf("frontend%s: status%d", path, response.StatusCode)
		}
	}
	response, err := http.Get(server.URL + "/missing.png")
	if err != nil {
		t.Fatal(err)
	}
	_ = response.Body.Close()
	if response.StatusCode != 404 {
		t.Fatal("missing asset should return404")
	}
}

func TestOptionalSupabaseResultSink(t *testing.T) {
	records := make(chan map[string]json.RawMessage, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" || r.Header.Get("Authorization") != "Bearer server-test-key" || r.Header.Get("apikey") != "server-test-key" {
			t.Error("result request did not use server authorization")
		}
		var record map[string]json.RawMessage
		if err := json.NewDecoder(r.Body).Decode(&record); err != nil {
			t.Error(err)
		}
		records <- record
		w.WriteHeader(http.StatusCreated)
	}))
	defer server.Close()
	h, r, _, _ := testRoom(t)
	h.resultURL = server.URL
	h.resultKey = "server-test-key"
	winner := 1
	h.finish(r, &winner, "time", 100000)
	select {
	case record := <-records:
		if string(record["winner"]) != "1" || string(record["reason"]) != `"time"` || len(record) != 7 {
			t.Fatal("unexpected persisted result fields")
		}
		if strings.Contains(string(record["players"]), "token") || strings.Contains(string(record["players"]), r.Players[0].Token) {
			t.Fatal("result leaked authentication token")
		}
	case <-time.After(3 * time.Second):
		t.Fatal("result sink did not receive record")
	}
}

func readAck(t *testing.T, conn *websocket.Conn, id string) Ack {
	t.Helper()
	_ = conn.SetReadDeadline(time.Now().Add(3 * time.Second))
	for {
		var msg map[string]json.RawMessage
		if err := conn.ReadJSON(&msg); err != nil {
			t.Fatal(err)
		}
		var event, requestID string
		_ = json.Unmarshal(msg["event"], &event)
		_ = json.Unmarshal(msg["requestId"], &requestID)
		if event == "ack" && requestID == id {
			b, _ := json.Marshal(msg)
			var ack Ack
			_ = json.Unmarshal(b, &ack)
			return ack
		}
	}
}

func readState(t *testing.T, conn *websocket.Conn) State {
	t.Helper()
	for {
		var state State
		if err := conn.ReadJSON(&state); err != nil {
			t.Fatal(err)
		}
		if state.Event == "state" {
			return state
		}
	}
}

func TestWebSocketSessionReplacementCloseCode(t *testing.T) {
	h := newHub(testData())
	server := httptest.NewServer(h.handler(t.TempDir()))
	defer server.Close()
	wsURL := "ws" + strings.TrimPrefix(server.URL, "http") + "/ws"
	a, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()
	b, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer b.Close()
	if err = a.WriteJSON(Request{Event: "create", RequestID: "create-first-tab"}); err != nil {
		t.Fatal(err)
	}
	created := readAck(t, a, "create-first-tab")
	if !created.OK || created.Token == "" {
		t.Fatal("first tab did not receive a session")
	}
	initial := readState(t, a)
	if err = b.WriteJSON(Request{Event: "resume", RequestID: "duplicate-tab", Code: initial.Code, Token: created.Token}); err != nil {
		t.Fatal(err)
	}
	if !readAck(t, b, "duplicate-tab").OK {
		t.Fatal("second tab could not take over its session")
	}
	_ = a.SetReadDeadline(time.Now().Add(3 * time.Second))
	for {
		_, _, err := a.ReadMessage()
		if err == nil {
			continue
		}
		if !websocket.IsCloseError(err, 4001) {
			t.Fatalf("old tab should receive session-replaced close code 4001: %v", err)
		}
		break
	}
	state := readState(t, b)
	if state.Code != initial.Code || state.You != 0 || !state.Players[0].Connected {
		t.Fatal("new tab lost its player after old tab was closed")
	}
}

// Real sockets finish a complete collection -> summon -> base destruction round.
func TestWebSocketFullGame(t *testing.T) {
	data := testData()
	data.Config.CollectMs = 650
	data.Config.BattleMs = 6000
	data.Config.SpawnMin = 30
	data.Config.SpawnMax = 50
	data.Config.BaseHP = 100
	data.Config.SummonCooldown = 30
	data.Dinos = []Dino{{ID: "fast", Name: "테스트 공룡", HP: 100, Attack: 100, Interval: 30, Speed: 2000, Range: 40, Weight: 1}}
	h := newHub(data)
	go h.run()
	defer h.close()
	server := httptest.NewServer(h.handler(t.TempDir()))
	defer server.Close()
	wsURL := "ws" + strings.TrimPrefix(server.URL, "http") + "/ws"
	a, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()
	b, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer b.Close()
	if err = a.WriteJSON(Request{Event: "create", RequestID: "create", Name: "A"}); err != nil {
		t.Fatal(err)
	}
	if ack := readAck(t, a, "create"); !ack.OK || ack.Token == "" {
		t.Fatal("create acknowledgement missing session token")
	}
	initial := readState(t, a)
	if err = b.WriteJSON(Request{Event: "join", RequestID: "join", Code: initial.Code, Name: "B"}); err != nil {
		t.Fatal(err)
	}
	if !readAck(t, b, "join").OK {
		t.Fatal("join failed")
	}
	_ = readState(t, b)
	_ = a.WriteJSON(Request{Event: "ready", RequestID: "ready-a"})
	if !readAck(t, a, "ready-a").OK {
		t.Fatal("ready failed")
	}
	_ = b.WriteJSON(Request{Event: "ready", RequestID: "ready-b"})
	if !readAck(t, b, "ready-b").OK {
		t.Fatal("ready failed")
	}
	type result struct {
		state State
		err   error
	}
	results := make(chan result, 2)
	drive := func(conn *websocket.Conn, collector bool) {
		seen := map[string]bool{}
		seq := 0
		_ = conn.SetReadDeadline(time.Now().Add(8 * time.Second))
		for {
			var state State
			if err := conn.ReadJSON(&state); err != nil {
				results <- result{err: err}
				return
			}
			if state.Event != "state" {
				continue
			}
			if state.Phase == "result" {
				results <- result{state: state}
				return
			}
			if collector && state.Phase == "collect" {
				for _, spawn := range state.Spawns {
					if !seen[spawn.ID] {
						seen[spawn.ID] = true
						seq++
						if err := conn.WriteJSON(Request{Event: "collect", RequestID: fmt.Sprintf("catch-%d", seq), ID: spawn.ID}); err != nil {
							results <- result{err: err}
							return
						}
					}
				}
			}
			if collector && state.Phase == "battle" && state.Players[state.You].Inventory["fast"] > 0 {
				seq++
				if err := conn.WriteJSON(Request{Event: "summon", RequestID: fmt.Sprintf("send-%d", seq), Type: "fast"}); err != nil {
					results <- result{err: err}
					return
				}
			}
		}
	}
	go drive(a, true)
	go drive(b, false)
	for i := 0; i < 2; i++ {
		select {
		case result := <-results:
			if result.err != nil {
				t.Fatal(result.err)
			}
			state := result.state
			if state.Winner == nil || *state.Winner != 0 || state.Reason != "destruction" || state.HP[1] != 0 {
				t.Fatalf("unexpected socket result: %+v", state)
			}
		case <-time.After(9 * time.Second):
			t.Fatal("full game did not finish")
		}
	}
}
