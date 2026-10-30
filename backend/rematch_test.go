package main

import "testing"

func TestCountdownGuardsInputsAndKeepsFullPhaseTimes(t *testing.T) {
	h, r, a, b := testRoom(t)
	h.data.Config.CountdownMs = 3000
	perform(t, h, a, Request{Event: "ready", RequestID: "r1"}, 100000)
	perform(t, h, b, Request{Event: "ready", RequestID: "r2"}, 100000)
	if r.Phase != "countdown" || r.NextPhase != "collect" || r.EndsAt != 103000 {
		t.Fatalf("wrong collection countdown: %+v", r)
	}
	r.Players[0].Spawns["old"] = Spawn{ID: "old", Type: "tyranno", ExpiresAt: 110000}
	if perform(t, h, a, Request{Event: "collect", RequestID: "early", ID: "old"}, 102999).OK {
		t.Fatal("collected during countdown")
	}
	h.step(r, 102999)
	if r.Phase != "countdown" {
		t.Fatal("countdown ended early")
	}
	h.step(r, 103025)
	if r.Phase != "collect" || r.EndsAt != 133000 {
		t.Fatal("collection duration includes countdown or drift")
	}
	r.Players[0].Inventory["tyranno"] = 3
	h.step(r, 133050)
	if r.Phase != "countdown" || r.NextPhase != "battle" || r.EndsAt != 136000 || len(r.Players[0].Spawns) != 0 {
		t.Fatal("battle countdown did not preserve inventory and clear spawns")
	}
	if perform(t, h, a, Request{Event: "summon", RequestID: "early-summon", Type: "tyranno"}, 135000).OK {
		t.Fatal("summoned during countdown")
	}
	h.step(r, 136010)
	if r.Phase != "battle" || r.EndsAt != 226000 || r.Players[0].Inventory["tyranno"] != 3 {
		t.Fatal("battle duration or inventory wrong")
	}
}

func TestRematchNeedsBothConsentAndResetsMatchOnly(t *testing.T) {
	h, r, a, b := testRoom(t)
	h.data.Config.CountdownMs = 3000
	winner := 0
	h.finish(r, &winner, "time", 100100)
	oldID, oldCode, oldToken, oldRound := r.ID, r.Code, r.Players[0].Token, r.Round
	r.Sequence = 42
	r.Players[0].Collected = 10
	r.Players[0].Summoned = 8
	r.Players[0].Kills = 3
	r.Players[0].BaseDamage = 100
	r.Players[0].Inventory["tyranno"] = 2
	r.HP[1] = 123
	yes, no := true, false
	request := Request{Event: "rematch", RequestID: "again-a", Ready: &yes, MatchID: oldID}
	if !perform(t, h, a, request, 100200).OK || !perform(t, h, a, request, 100201).OK {
		t.Fatal("rematch request/replay failed")
	}
	if r.Phase != "result" || !r.Players[0].RematchReady || r.Players[1].RematchReady {
		t.Fatal("one player started rematch")
	}
	perform(t, h, a, Request{Event: "rematch", RequestID: "cancel", Ready: &no}, 100250)
	if r.Players[0].RematchReady {
		t.Fatal("cancel did not work")
	}
	perform(t, h, b, Request{Event: "rematch", RequestID: "again-b", Ready: &yes}, 100260)
	perform(t, h, a, Request{Event: "rematch", RequestID: "again-a2", Ready: &yes}, 100300)
	if r.Phase != "countdown" || r.NextPhase != "collect" || r.ID == oldID || r.Code != oldCode || r.Round != oldRound+1 || r.Players[0].Token != oldToken {
		t.Fatal("rematch identity / countdown wrong")
	}
	if r.Winner != nil || r.Reason != "" || r.HP[1] != h.data.Config.BaseHP || len(r.Units) != 0 || r.Sequence != 42 {
		t.Fatal("arena not reset / IDs could repeat")
	}
	p := r.Players[0]
	if p.Collected+p.Summoned+p.Kills+p.BaseDamage != 0 || p.Inventory["tyranno"] != 0 || p.RematchReady || p.LastSummon != 0 {
		t.Fatal("player round state leaked")
	}
	if perform(t, h, a, Request{Event: "collect", RequestID: "stale", MatchID: oldID, ID: "old"}, 103500).OK {
		t.Fatal("old match mutation accepted")
	}
}

func TestRematchUnavailableAfterLeaveOrDisconnect(t *testing.T) {
	for _, left := range []bool{false, true} {
		h, r, a, b := testRoom(t)
		h.finish(r, nil, "time", 100100)
		if left {
			perform(t, h, b, Request{Event: "leave", RequestID: "bye"}, 100200)
		} else {
			h.disconnect(b, 100200)
		}
		if perform(t, h, a, Request{Event: "rematch", RequestID: "again"}, 100300).OK {
			t.Fatal("started without connected opponent consent")
		}
		if r.Phase != "result" || r.Players[0].RematchReady {
			t.Fatal("invalid request changed state")
		}
	}
	h, r, a, _ := testRoom(t)
	if perform(t, h, a, Request{Event: "rematch", RequestID: "lobby-again"}, 100200).OK || r.Phase != "lobby" {
		t.Fatal("rematched in lobby")
	}
}

func TestRoundStatsAreAuthoritativeAndClampOverkill(t *testing.T) {
	h, r, a, _ := testRoom(t)
	r.Phase = "battle"
	r.EndsAt = 200000
	r.LastTick = 100000
	r.Players[0].Inventory["tyranno"] = 1
	req := Request{Event: "summon", RequestID: "one", Type: "tyranno"}
	perform(t, h, a, req, 100001)
	perform(t, h, a, req, 100002)
	if r.Players[0].Summoned != 1 {
		t.Fatal("duplicate summon changed stats")
	}
	r.Units = []*Unit{{ID: "a", Type: "tyranno", Side: 0, X: 580, HP: 200}, {ID: "b", Type: "tyranno", Side: 1, X: 620, HP: 20}}
	h.combat(r, 100050)
	if r.Players[0].Kills != 1 || r.Players[1].Kills != 0 {
		t.Fatal("kill not credited correctly")
	}
	r.HP[1] = 12
	r.LastTick = 100050
	r.Units = []*Unit{{ID: "c", Type: "tyranno", Side: 0, X: 1100, HP: 200}}
	h.combat(r, 100100)
	if r.Players[0].BaseDamage != 12 || r.HP[1] != 0 {
		t.Fatal("counted overkill as base damage")
	}
	snapshot := h.snapshot(r, 0, 100100)
	if snapshot.MatchID != r.ID || snapshot.Round != r.Round || snapshot.Players[0].Kills != 1 || snapshot.Players[0].Summoned != 1 || snapshot.Players[0].BaseDamage != 12 {
		t.Fatal("snapshot stats missing")
	}
}

func TestCountdownDisconnectStillFinishesAndCannotRestartAlone(t *testing.T) {
	h, r, a, b := testRoom(t)
	h.data.Config.CountdownMs = 3000
	h.beginCountdown(r, "collect", 100000)
	h.disconnect(b, 100500)
	h.step(r, 115500)
	if r.Phase != "result" || r.Winner == nil || *r.Winner != 0 {
		t.Fatal("countdown disconnect not judged")
	}
	if perform(t, h, a, Request{Event: "rematch", RequestID: "alone"}, 115501).OK {
		t.Fatal("alone rematch accepted")
	}
}

func TestRematchConsentSurvivesRefreshButNotExplicitLeave(t *testing.T) {
	h, r, a, b := testRoom(t)
	h.data.Config.CountdownMs = 3000
	h.finish(r, nil, "time", 100100)
	perform(t, h, a, Request{Event: "rematch", RequestID: "consent"}, 100200)
	token := r.Players[0].Token
	h.disconnect(a, 100300)
	if !r.Players[0].RematchReady {
		t.Fatal("refresh forgot existing consent")
	}
	if perform(t, h, b, Request{Event: "rematch", RequestID: "while-offline"}, 100310).OK {
		t.Fatal("started with offline peer")
	}
	newA := testClient(h)
	if !perform(t, h, newA, Request{Event: "resume", RequestID: "refresh", Token: token}, 100400).OK {
		t.Fatal("refresh resume failed")
	}
	if !h.snapshot(r, 0, 100400).Players[0].RematchReady {
		t.Fatal("consent missing after resume")
	}
	if !perform(t, h, b, Request{Event: "rematch", RequestID: "both-back"}, 100500).OK || r.Phase != "countdown" {
		t.Fatal("connected players could not rematch")
	}
}
