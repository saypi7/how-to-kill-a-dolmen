package main

import (
	"bytes"
	crand "crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"math"
	"math/big"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"
	"unicode"

	"github.com/gorilla/websocket"
)

type Config struct {
	CollectMs      int64      `json:"collectMs"`
	BattleMs       int64      `json:"battleMs"`
	BaseHP         int        `json:"baseHp"`
	TickMs         int64      `json:"tickMs"`
	SpawnMin       int64      `json:"spawnMin"`
	SpawnMax       int64      `json:"spawnMax"`
	VisibleMin     int64      `json:"visibleMin"`
	VisibleMax     int64      `json:"visibleMax"`
	Bushes         int        `json:"bushes"`
	Width          float64    `json:"width"`
	Bases          [2]float64 `json:"bases"`
	SummonCooldown int64      `json:"summonCooldown"`
	DisconnectMs   int64      `json:"disconnectMs"`
}

type Dino struct {
	ID        string  `json:"id"`
	Name      string  `json:"name"`
	Class     string  `json:"class"`
	RoleLabel string  `json:"roleLabel"`
	HP        int     `json:"hp"`
	Attack    int     `json:"attack"`
	Interval  int64   `json:"interval"`
	Speed     float64 `json:"speed"`
	Range     float64 `json:"range"`
	Weight    int     `json:"weight"`
}

type GameData struct {
	Config Config `json:"config"`
	Dinos  []Dino `json:"dinos"`
}

func loadData(path string) (GameData, error) {
	var data GameData
	content, err := os.ReadFile(path)
	if err != nil {
		return data, err
	}
	if err = json.Unmarshal(content, &data); err != nil {
		return data, err
	}
	c := data.Config
	if c.CollectMs <= 0 || c.BattleMs <= 0 || c.BaseHP <= 0 || c.TickMs < 10 || c.TickMs > 1000 || c.SpawnMin <= 0 || c.SpawnMax < c.SpawnMin || c.VisibleMin <= 0 || c.VisibleMax < c.VisibleMin || c.Bushes < 1 || c.Bushes > 30 || c.Width <= 0 || c.Bases[0] < 0 || c.Bases[1] > c.Width || c.Bases[0] >= c.Bases[1] || c.DisconnectMs <= 0 || c.SummonCooldown < 0 {
		return data, errors.New("invalid game config")
	}
	seen, total := map[string]bool{}, 0
	for _, d := range data.Dinos {
		if d.ID == "" || seen[d.ID] || d.HP <= 0 || d.Attack <= 0 || d.Interval <= 0 || d.Speed <= 0 || d.Range <= 0 || d.Weight < 0 {
			return data, fmt.Errorf("invalid dinosaur: %s", d.ID)
		}
		if d.Class != "tank" && d.Class != "assault" && d.Class != "skirmisher" && d.Class != "flying" {
			return data, fmt.Errorf("invalid dinosaur class: %s", d.ID)
		}
		if d.RoleLabel == "" {
			return data, fmt.Errorf("missing dinosaur role label: %s", d.ID)
		}
		seen[d.ID], total = true, total+d.Weight
	}
	if total <= 0 {
		return data, errors.New("at least one dinosaur must have positive weight")
	}
	return data, nil
}

type Request struct {
	Event     string `json:"event"`
	RequestID string `json:"requestId"`
	Name      string `json:"name"`
	Code      string `json:"code"`
	Token     string `json:"token"`
	ID        string `json:"id"`
	Type      string `json:"type"`
	Ready     *bool  `json:"ready,omitempty"`
}

type Ack struct {
	Event     string `json:"event"`
	RequestID string `json:"requestId"`
	OK        bool   `json:"ok"`
	Error     string `json:"error,omitempty"`
	Token     string `json:"token,omitempty"`
}

type Spawn struct {
	ID        string `json:"id"`
	Type      string `json:"type"`
	Bush      int    `json:"bush"`
	ExpiresAt int64  `json:"expiresAt"`
}

type Unit struct {
	ID         string  `json:"id"`
	Type       string  `json:"type"`
	Side       int     `json:"side"`
	X          float64 `json:"x"`
	HP         int     `json:"hp"`
	Attacking  bool    `json:"attacking"`
	Target     string  `json:"target"`
	LastAttack int64   `json:"attackAt"`
}

type Player struct {
	Name           string
	Token          string
	Ready          bool
	Client         *Client
	DisconnectedAt int64
	Inventory      map[string]int
	Spawns         map[string]Spawn
	NextSpawn      int64
	LastSummon     int64
	Collected      int
	Left           bool
	Replies        map[string][]byte
	ReplyOrder     []string
}

type Room struct {
	ID        string
	Code      string
	Phase     string
	Players   [2]*Player
	EndsAt    int64
	HP        [2]int
	Units     []*Unit
	Winner    *int
	Reason    string
	LastTick  int64
	UpdatedAt int64
	Sequence  uint64
}

type PlayerView struct {
	Name           string         `json:"name"`
	Ready          bool           `json:"ready"`
	Connected      bool           `json:"connected"`
	Inventory      map[string]int `json:"inventory"`
	Collected      int            `json:"collected"`
	ReconnectUntil int64          `json:"reconnectUntil,omitempty"`
}

type State struct {
	Event     string         `json:"event"`
	Code      string         `json:"code"`
	Phase     string         `json:"phase"`
	EndsAt    int64          `json:"endsAt"`
	ServerNow int64          `json:"serverNow"`
	You       int            `json:"you"`
	Players   [2]*PlayerView `json:"players"`
	HP        [2]int         `json:"hp"`
	Units     []*Unit        `json:"units"`
	Spawns    []Spawn        `json:"spawns"`
	Winner    *int           `json:"winner"`
	Reason    string         `json:"reason"`
}

type Session struct {
	Room *Room
	Side int
}

type Hub struct {
	mu         sync.Mutex
	data       GameData
	dinos      map[string]Dino
	rooms      map[string]*Room
	sessions   map[string]Session
	stop       chan struct{}
	done       chan struct{}
	upgrader   websocket.Upgrader
	resultURL  string
	resultKey  string
	httpClient *http.Client
}

type Client struct {
	hub       *Hub
	conn      *websocket.Conn
	send      chan []byte
	done      chan struct{}
	once      sync.Once
	room      *Room
	side      int
	replies   map[string][]byte
	order     []string
	rateAt    int64
	rateCount int
}

func randomHex(n int) string {
	b := make([]byte, n)
	if _, err := crand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}

func randomInt(n int64) int64 {
	if n <= 1 {
		return 0
	}
	v, err := crand.Int(crand.Reader, big.NewInt(n))
	if err != nil {
		panic(err)
	}
	return v.Int64()
}

func (h *Hub) between(a, b int64) int64 { return a + randomInt(b-a+1) }

func newHub(data GameData) *Hub {
	h := &Hub{data: data, dinos: map[string]Dino{}, rooms: map[string]*Room{}, sessions: map[string]Session{}, stop: make(chan struct{}), done: make(chan struct{}), httpClient: &http.Client{Timeout: 5 * time.Second}}
	for _, d := range data.Dinos {
		h.dinos[d.ID] = d
	}
	allowed := map[string]bool{}
	for _, origin := range strings.Split(os.Getenv("ALLOWED_ORIGINS"), ",") {
		if origin = strings.TrimSpace(origin); origin != "" {
			allowed[origin] = true
		}
	}
	if len(allowed) == 0 {
		allowed["http://localhost:5173"], allowed["http://127.0.0.1:5173"] = true, true
	}
	h.upgrader = websocket.Upgrader{ReadBufferSize: 1024, WriteBufferSize: 4096, CheckOrigin: func(r *http.Request) bool {
		origin := r.Header.Get("Origin")
		if origin == "" || allowed[origin] {
			return true
		}
		u, err := url.Parse(origin)
		return err == nil && (u.Scheme == "http" || u.Scheme == "https") && u.Host == r.Host
	}}
	if base, key := strings.TrimRight(os.Getenv("SUPABASE_URL"), "/"), os.Getenv("SUPABASE_SERVICE_ROLE_KEY"); base != "" && key != "" {
		h.resultURL, h.resultKey = base+"/rest/v1/game_results", key
	}
	return h
}

func (h *Hub) run() {
	defer close(h.done)
	ticker := time.NewTicker(time.Duration(h.data.Config.TickMs) * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-h.stop:
			return
		case now := <-ticker.C:
			h.mu.Lock()
			for _, room := range h.rooms {
				h.step(room, now.UnixMilli())
				h.broadcast(room, now.UnixMilli())
			}
			h.mu.Unlock()
		}
	}
}

func (h *Hub) close() {
	close(h.stop)
	<-h.done
	h.mu.Lock()
	defer h.mu.Unlock()
	for _, room := range h.rooms {
		for _, p := range room.Players {
			if p != nil && p.Client != nil {
				p.Client.close()
			}
		}
	}
}

func (c *Client) close() {
	c.once.Do(func() {
		close(c.done)
		if c.conn != nil {
			_ = c.conn.Close()
		}
	})
}

// A duplicated tab may take over a valid player session. Tell the previous
// browser explicitly so its normal reconnect loop does not take it back.
func (c *Client) replace() {
	c.once.Do(func() {
		close(c.done)
		if c.conn != nil {
			_ = c.conn.WriteControl(websocket.CloseMessage, websocket.FormatCloseMessage(4001, "session replaced"), time.Now().Add(250*time.Millisecond))
			_ = c.conn.Close()
		}
	})
}
func (c *Client) queue(data []byte) {
	select {
	case <-c.done:
		return
	default:
	}
	select {
	case c.send <- data:
	default:
		c.close()
	}
}

func (h *Hub) websocket(w http.ResponseWriter, r *http.Request) {
	conn, err := h.upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	c := &Client{hub: h, conn: conn, send: make(chan []byte, 64), done: make(chan struct{}), side: -1, replies: map[string][]byte{}}
	go c.writeLoop()
	conn.SetReadLimit(2048)
	_ = conn.SetReadDeadline(time.Now().Add(45 * time.Second))
	conn.SetPongHandler(func(string) error { return conn.SetReadDeadline(time.Now().Add(45 * time.Second)) })
	defer func() { c.close(); h.mu.Lock(); h.disconnect(c, time.Now().UnixMilli()); h.mu.Unlock() }()
	for {
		var req Request
		if err := conn.ReadJSON(&req); err != nil {
			return
		}
		h.mu.Lock()
		h.handle(c, req, time.Now().UnixMilli())
		h.mu.Unlock()
	}
}

func (c *Client) writeLoop() {
	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()
	defer c.close()
	for {
		select {
		case <-c.done:
			return
		case data := <-c.send:
			_ = c.conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
			if err := c.conn.WriteMessage(websocket.TextMessage, data); err != nil {
				return
			}
		case <-ticker.C:
			if err := c.conn.WriteControl(websocket.PingMessage, nil, time.Now().Add(5*time.Second)); err != nil {
				return
			}
		}
	}
}

func cleanName(name string) string {
	runes := []rune(strings.TrimSpace(name))
	if len(runes) > 18 {
		runes = runes[:18]
	}
	return strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return -1
		}
		return r
	}, string(runes))
}

func remember(replies map[string][]byte, order *[]string, id string, data []byte) {
	if _, exists := replies[id]; !exists {
		*order = append(*order, id)
	}
	replies[id] = data
	if len(*order) > 512 {
		delete(replies, (*order)[0])
		*order = (*order)[1:]
	}
}

func (h *Hub) handle(c *Client, req Request, now int64) {
	ack := Ack{Event: "ack", RequestID: req.RequestID, OK: false}
	if req.RequestID == "" || len(req.RequestID) > 96 {
		ack.Error = "요청 번호가 올바르지 않아요."
		b, _ := json.Marshal(ack)
		c.queue(b)
		return
	}
	if now-c.rateAt >= 1000 {
		c.rateAt, c.rateCount = now, 0
	}
	c.rateCount++
	if c.rateCount > 80 {
		ack.Error = "요청이 너무 빨라요. 잠시 후 다시 시도하세요."
		b, _ := json.Marshal(ack)
		c.queue(b)
		return
	}
	var p *Player
	if c.room != nil && c.side >= 0 {
		p = c.room.Players[c.side]
		if p == nil || p.Client != c {
			c.room, c.side, p = nil, -1, nil
		}
	}
	if p != nil {
		if b := p.Replies[req.RequestID]; b != nil {
			c.queue(b)
			return
		}
	}
	if b := c.replies[req.RequestID]; b != nil {
		c.queue(b)
		return
	}
	err := ""
	switch req.Event {
	case "create":
		if c.room != nil {
			err = "이미 방에 참가 중이에요."
			break
		}
		if len(h.rooms) >= 1000 {
			err = "서버에 방이 가득 찼어요."
			break
		}
		name := cleanName(req.Name)
		if name == "" {
			name = "플레이어 1"
		}
		code := ""
		const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
		for code == "" || h.rooms[code] != nil {
			b := make([]byte, 6)
			for i := range b {
				b[i] = alphabet[randomInt(int64(len(alphabet)))]
			}
			code = string(b)
		}
		room := &Room{ID: randomHex(16), Code: code, Phase: "lobby", HP: [2]int{h.data.Config.BaseHP, h.data.Config.BaseHP}, Units: []*Unit{}, UpdatedAt: now, LastTick: now}
		h.rooms[code] = room
		h.attach(c, room, 0, h.newPlayer(name))
		ack.Token = room.Players[0].Token
	case "join":
		if c.room != nil {
			err = "이미 방에 참가 중이에요."
			break
		}
		room := h.rooms[strings.ToUpper(strings.TrimSpace(req.Code))]
		if room == nil {
			err = "방 코드를 찾을 수 없어요."
			break
		}
		if room.Phase != "lobby" {
			err = "이미 게임이 시작된 방이에요."
			break
		}
		side := -1
		for i, p := range room.Players {
			if p == nil {
				side = i
				break
			}
		}
		if side < 0 {
			err = "방에는 두 명까지만 들어갈 수 있어요."
			break
		}
		name := cleanName(req.Name)
		if name == "" {
			name = fmt.Sprintf("플레이어 %d", side+1)
		}
		h.attach(c, room, side, h.newPlayer(name))
		ack.Token = room.Players[side].Token
	case "resume":
		if c.room != nil {
			err = "이미 방에 참가 중이에요."
			break
		}
		s, ok := h.sessions[req.Token]
		if !ok || (req.Code != "" && s.Room.Code != strings.ToUpper(strings.TrimSpace(req.Code))) {
			err = "다시 연결할 세션이 없어요. 방을 새로 만들어 주세요."
			break
		}
		p := s.Room.Players[s.Side]
		if p == nil {
			err = "세션이 만료됐어요."
			break
		}
		if p.DisconnectedAt > 0 && now-p.DisconnectedAt >= h.data.Config.DisconnectMs && s.Room.Phase != "result" {
			h.step(s.Room, now)
			if s.Room.Phase != "result" {
				err = "재연결 제한시간이 지났어요."
				break
			}
		}
		if p.Client != nil {
			old := p.Client
			old.room, old.side = nil, -1
			old.replace()
		}
		h.attach(c, s.Room, s.Side, p)
		ack.Token = p.Token
	case "ready":
		if p == nil {
			err = "먼저 방에 입장해 주세요."
			break
		}
		if c.room.Phase != "lobby" {
			err = "대기실에서만 준비할 수 있어요."
			break
		}
		if req.Ready != nil {
			p.Ready = *req.Ready
		} else {
			p.Ready = !p.Ready
		}
		if a, b := c.room.Players[0], c.room.Players[1]; a != nil && b != nil && a.Ready && b.Ready && a.Client != nil && b.Client != nil {
			h.startCollection(c.room, now)
		}
	case "collect":
		if p == nil || c.room.Phase != "collect" || now >= c.room.EndsAt {
			err = "지금은 수집 시간이 아니에요."
			break
		}
		spawn, ok := p.Spawns[req.ID]
		if !ok || now >= spawn.ExpiresAt {
			delete(p.Spawns, req.ID)
			err = "공룡이 이미 숨어 버렸어요."
			break
		}
		delete(p.Spawns, req.ID)
		p.Inventory[spawn.Type]++
		p.Collected++
	case "summon":
		if p == nil || c.room.Phase != "battle" || now >= c.room.EndsAt {
			err = "지금은 전투 시간이 아니에요."
			break
		}
		d, ok := h.dinos[req.Type]
		if !ok || p.Inventory[req.Type] <= 0 {
			err = "보유한 공룡이 없어요."
			break
		}
		if p.LastSummon > 0 && now-p.LastSummon < h.data.Config.SummonCooldown {
			err = "공룡이 출발 중이에요. 잠시만 기다려 주세요."
			break
		}
		if len(c.room.Units) >= 256 {
			err = "전장이 가득 찼어요."
			break
		}
		p.LastSummon = now
		p.Inventory[req.Type]--
		c.room.Sequence++
		direction := 1.0
		if c.side == 1 {
			direction = -1
		}
		c.room.Units = append(c.room.Units, &Unit{ID: fmt.Sprintf("u%d", c.room.Sequence), Type: d.ID, Side: c.side, X: h.data.Config.Bases[c.side] + direction*45, HP: d.HP})
	case "leave":
		if p == nil {
			err = "참가 중인 방이 없어요."
			break
		}
		room, side := c.room, c.side
		// Requests can arrive just after the deadline but before the next tick.
		// Resolve the battle timer first so leaving cannot change a finished win.
		if room.Phase == "battle" && now >= room.EndsAt {
			h.step(room, now)
		}
		if room.Phase == "collect" || room.Phase == "battle" {
			winner := 1 - side
			h.finish(room, &winner, "leave", now)
		}
		delete(h.sessions, p.Token)
		if room.Phase == "result" {
			p.Client, p.Left = nil, true
		} else {
			room.Players[side] = nil
		}
		c.room, c.side = nil, -1
		h.broadcast(room, now)
		h.removeIfEmpty(room)
	default:
		err = "알 수 없는 요청이에요."
	}
	ack.OK, ack.Error = err == "", err
	b, _ := json.Marshal(ack)
	remember(c.replies, &c.order, req.RequestID, b)
	if c.room != nil {
		if p := c.room.Players[c.side]; p != nil {
			remember(p.Replies, &p.ReplyOrder, req.RequestID, b)
		}
		c.room.UpdatedAt = now
	}
	c.queue(b)
	if c.room != nil {
		h.broadcast(c.room, now)
	}
}

func (h *Hub) newPlayer(name string) *Player {
	p := &Player{Name: name, Token: randomHex(32), Inventory: map[string]int{}, Spawns: map[string]Spawn{}, Replies: map[string][]byte{}}
	for _, d := range h.data.Dinos {
		p.Inventory[d.ID] = 0
	}
	return p
}

func (h *Hub) attach(c *Client, room *Room, side int, p *Player) {
	room.Players[side] = p
	p.Client = c
	p.DisconnectedAt = 0
	c.room = room
	c.side = side
	h.sessions[p.Token] = Session{Room: room, Side: side}
}

func (h *Hub) disconnect(c *Client, now int64) {
	if c.room == nil || c.side < 0 {
		return
	}
	room := c.room
	p := room.Players[c.side]
	if p == nil || p.Client != c {
		return
	}
	p.Client = nil
	p.DisconnectedAt = now
	p.Ready = false
	room.UpdatedAt = now
	h.broadcast(room, now)
}

func (h *Hub) removeIfEmpty(room *Room) {
	for _, p := range room.Players {
		if p != nil && !p.Left {
			return
		}
	}
	delete(h.rooms, room.Code)
}

func (h *Hub) startCollection(room *Room, now int64) {
	room.Phase = "collect"
	room.EndsAt = now + h.data.Config.CollectMs
	room.LastTick = now
	for _, p := range room.Players {
		p.NextSpawn = now + 200
	}
}

func (h *Hub) weightedDino() Dino {
	total := int64(0)
	for _, d := range h.data.Dinos {
		total += int64(d.Weight)
	}
	n := randomInt(total)
	for _, d := range h.data.Dinos {
		n -= int64(d.Weight)
		if n < 0 {
			return d
		}
	}
	return h.data.Dinos[0]
}

func (h *Hub) step(room *Room, now int64) {
	cfg := h.data.Config
	expired := [2]bool{}
	for i, p := range room.Players {
		expired[i] = p != nil && p.Client == nil && p.DisconnectedAt > 0 && now-p.DisconnectedAt >= cfg.DisconnectMs
	}
	if room.Phase == "collect" || room.Phase == "battle" {
		if expired[0] || expired[1] {
			var winner *int
			if !(expired[0] && expired[1]) {
				w := 0
				if expired[0] {
					w = 1
				}
				winner = &w
			}
			h.finish(room, winner, "disconnect", now)
		}
	} else if room.Phase == "lobby" {
		for i, yes := range expired {
			if yes {
				delete(h.sessions, room.Players[i].Token)
				room.Players[i] = nil
			}
		}
		h.removeIfEmpty(room)
	}
	if (room.Phase == "lobby" || room.Phase == "result") && now-room.UpdatedAt > 30*60*1000 {
		for _, p := range room.Players {
			if p != nil {
				delete(h.sessions, p.Token)
				if p.Client != nil {
					p.Client.close()
				}
			}
		}
		delete(h.rooms, room.Code)
		return
	}
	if room.Phase == "collect" {
		if now >= room.EndsAt {
			room.Phase = "battle"
			room.EndsAt = now + cfg.BattleMs
			room.LastTick = now
			for _, p := range room.Players {
				if p != nil {
					p.Spawns = map[string]Spawn{}
				}
			}
			return
		}
		for _, p := range room.Players {
			if p == nil {
				continue
			}
			occupied := map[int]bool{}
			for id, spawn := range p.Spawns {
				if now >= spawn.ExpiresAt {
					delete(p.Spawns, id)
				} else {
					occupied[spawn.Bush] = true
				}
			}
			if now >= p.NextSpawn {
				p.NextSpawn = now + h.between(cfg.SpawnMin, cfg.SpawnMax)
				available := []int{}
				for i := 0; i < cfg.Bushes; i++ {
					if !occupied[i] {
						available = append(available, i)
					}
				}
				if len(available) > 0 {
					d := h.weightedDino()
					room.Sequence++
					id := fmt.Sprintf("s%d", room.Sequence)
					p.Spawns[id] = Spawn{ID: id, Type: d.ID, Bush: available[randomInt(int64(len(available)))], ExpiresAt: now + h.between(cfg.VisibleMin, cfg.VisibleMax)}
				}
			}
		}
	} else if room.Phase == "battle" {
		if now >= room.EndsAt {
			var winner *int
			if room.HP[0] != room.HP[1] {
				w := 0
				if room.HP[1] > room.HP[0] {
					w = 1
				}
				winner = &w
			}
			h.finish(room, winner, "time", now)
			return
		}
		h.combat(room, now)
	}
	room.LastTick = now
}

func (h *Hub) combat(room *Room, now int64) {
	dt := math.Min(float64(now-room.LastTick)/1000, 0.25)
	if dt <= 0 {
		return
	}
	damage := map[string]int{}
	baseDamage := [2]int{}
	positions := map[string]float64{}
	for _, u := range room.Units {
		if u.HP <= 0 {
			continue
		}
		d := h.dinos[u.Type]
		direction := 1.0
		if u.Side == 1 {
			direction = -1
		}
		var target *Unit
		distance := math.Inf(1)
		for _, enemy := range room.Units {
			if enemy.Side != u.Side && enemy.HP > 0 {
				gap := math.Abs(enemy.X - u.X)
				if gap < distance {
					target, distance = enemy, gap
				}
			}
		}
		u.Attacking = false
		u.Target = ""
		if target != nil {
			u.Target = target.ID
			if distance <= d.Range+0.01 {
				u.Attacking = true
				if u.LastAttack == 0 || now-u.LastAttack >= d.Interval {
					damage[target.ID] += d.Attack
					u.LastAttack = now
				}
			} else {
				move := math.Min(d.Speed*dt, math.Min(distance-d.Range, distance/2))
				moveDirection := direction
				if target.X < u.X {
					moveDirection = -1
				} else if target.X > u.X {
					moveDirection = 1
				}
				positions[u.ID] = u.X + moveDirection*move
			}
		} else {
			enemySide := 1 - u.Side
			distance = math.Abs(h.data.Config.Bases[enemySide] - u.X)
			u.Target = fmt.Sprintf("base:%d", enemySide)
			if distance <= d.Range+0.01 {
				u.Attacking = true
				if u.LastAttack == 0 || now-u.LastAttack >= d.Interval {
					baseDamage[enemySide] += d.Attack
					u.LastAttack = now
				}
			} else {
				positions[u.ID] = u.X + direction*math.Min(d.Speed*dt, distance-d.Range)
			}
		}
	}
	alive := make([]*Unit, 0, len(room.Units))
	for _, u := range room.Units {
		u.HP -= damage[u.ID]
		if x, ok := positions[u.ID]; ok {
			u.X = x
		}
		if u.HP > 0 {
			alive = append(alive, u)
		}
	}
	room.Units = alive
	for i := range room.HP {
		room.HP[i] = max(0, room.HP[i]-baseDamage[i])
	}
	if room.HP[0] == 0 || room.HP[1] == 0 {
		var winner *int
		if !(room.HP[0] == 0 && room.HP[1] == 0) {
			w := 0
			if room.HP[0] == 0 {
				w = 1
			}
			winner = &w
		}
		h.finish(room, winner, "destruction", now)
	}
}

func (h *Hub) finish(room *Room, winner *int, reason string, now int64) {
	if room.Phase == "result" {
		return
	}
	room.Phase = "result"
	room.Winner = winner
	room.Reason = reason
	room.EndsAt = 0
	room.UpdatedAt = now
	for i, p := range room.Players {
		if p != nil {
			p.Spawns = map[string]Spawn{}
			if winner != nil && i != *winner {
				for id := range p.Inventory {
					p.Inventory[id] = 0
				}
			}
		}
	}
	if winner != nil {
		survivors := []*Unit{}
		for _, u := range room.Units {
			if u.Side == *winner {
				survivors = append(survivors, u)
			}
		}
		room.Units = survivors
	}
	if h.resultURL != "" {
		players := []map[string]any{}
		for _, p := range room.Players {
			if p == nil {
				players = append(players, map[string]any{"name": "", "collected": 0})
			} else {
				players = append(players, map[string]any{"name": p.Name, "collected": p.Collected})
			}
		}
		record := map[string]any{"id": room.ID, "room_code": room.Code, "winner": winner, "reason": reason, "players": players, "base_hp": room.HP, "finished_at": time.UnixMilli(now).UTC().Format(time.RFC3339Nano)}
		body, _ := json.Marshal(record)
		go h.persistResult(body)
	}
}

func (h *Hub) persistResult(body []byte) {
	request, err := http.NewRequest(http.MethodPost, h.resultURL, bytes.NewReader(body))
	if err != nil {
		log.Printf("result save request: %v", err)
		return
	}
	request.Header.Set("apikey", h.resultKey)
	request.Header.Set("Authorization", "Bearer "+h.resultKey)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Prefer", "return=minimal,resolution=ignore-duplicates")
	response, err := h.httpClient.Do(request)
	if err != nil {
		log.Printf("optional result save failed: %v", err)
		return
	}
	defer response.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 4096))
	if response.StatusCode >= 300 {
		log.Printf("optional result save status: %d", response.StatusCode)
	}
}

func (h *Hub) snapshot(room *Room, side int, now int64) State {
	state := State{Event: "state", Code: room.Code, Phase: room.Phase, EndsAt: room.EndsAt, ServerNow: now, You: side, HP: room.HP, Units: room.Units, Spawns: []Spawn{}, Winner: room.Winner, Reason: room.Reason}
	for i, p := range room.Players {
		if p != nil {
			state.Players[i] = &PlayerView{Name: p.Name, Ready: p.Ready, Connected: p.Client != nil, Inventory: p.Inventory, Collected: p.Collected}
			if p.DisconnectedAt > 0 {
				state.Players[i].ReconnectUntil = p.DisconnectedAt + h.data.Config.DisconnectMs
			}
		}
	}
	if side >= 0 && room.Players[side] != nil {
		for _, spawn := range room.Players[side].Spawns {
			state.Spawns = append(state.Spawns, spawn)
		}
	}
	return state
}

func (h *Hub) broadcast(room *Room, now int64) {
	for side, p := range room.Players {
		if p != nil && p.Client != nil {
			b, _ := json.Marshal(h.snapshot(room, side, now))
			p.Client.queue(b)
		}
	}
}

func (h *Hub) handler(frontend string) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/ws", h.websocket)
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		h.mu.Lock()
		count := len(h.rooms)
		h.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "rooms": count})
	})
	files := http.FileServer(http.Dir(frontend))
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		if _, err := os.Stat(filepath.Join(frontend, "index.html")); err != nil {
			http.Error(w, "Frontend not built. Run npm install && npm run build from project root, or run Vite for development.", http.StatusServiceUnavailable)
			return
		}
		clean := filepath.Clean("/" + r.URL.Path)
		if _, err := os.Stat(filepath.Join(frontend, clean)); err != nil && filepath.Ext(clean) == "" {
			http.ServeFile(w, r, filepath.Join(frontend, "index.html"))
			return
		}
		files.ServeHTTP(w, r)
	})
	return mux
}

func main() {
	path := os.Getenv("GAME_DATA_PATH")
	if path == "" {
		path = "../public/game-data.json"
		if _, err := os.Stat(path); err != nil {
			path = "public/game-data.json"
		}
	}
	data, err := loadData(path)
	if err != nil {
		log.Fatalf("load game data %s: %v", path, err)
	}
	hub := newHub(data)
	go hub.run()
	frontend := os.Getenv("FRONTEND_DIR")
	if frontend == "" {
		frontend = "../dist"
	}
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	server := &http.Server{Addr: ":" + port, Handler: hub.handler(frontend), ReadHeaderTimeout: 5 * time.Second, IdleTimeout: 60 * time.Second}
	signals := make(chan os.Signal, 1)
	signal.Notify(signals, os.Interrupt, syscall.SIGTERM)
	go func() { <-signals; _ = server.Close(); hub.close() }()
	log.Printf("Dino battle listening on http://localhost:%s", port)
	if err = server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}
