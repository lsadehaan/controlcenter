package filewatcher

import (
	"testing"
)

func TestCheckTimeRestrictions_ZeroValues(t *testing.T) {
	w := &Watcher{}
	restrictions := TimeRestrictions{}

	// Zero-value time restrictions should allow processing (no restrictions)
	if !w.checkTimeRestrictions(restrictions) {
		t.Error("zero-value time restrictions should return true (no restrictions)")
	}
}

func TestCheckTimeRestrictions_AllDayWindow(t *testing.T) {
	w := &Watcher{}
	restrictions := TimeRestrictions{
		StartHour:   0,
		StartMinute: 0,
		EndHour:     23,
		EndMinute:   59,
	}

	if !w.checkTimeRestrictions(restrictions) {
		t.Error("all-day window should allow processing")
	}
}

func TestCheckTimeRestrictions_NarrowWindow(t *testing.T) {
	w := &Watcher{}
	// Window from 02:00 to 02:01 — very unlikely to be the current time
	restrictions := TimeRestrictions{
		StartHour:   2,
		StartMinute: 0,
		EndHour:     2,
		EndMinute:   1,
	}

	// We can't easily assert true/false without controlling time,
	// but we can verify it doesn't panic
	_ = w.checkTimeRestrictions(restrictions)
}
