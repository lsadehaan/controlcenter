package workflow

import (
	"encoding/json"
	"testing"
)

func TestDeepCopyMap_Nil(t *testing.T) {
	result := deepCopyMap(nil)
	if result != nil {
		t.Errorf("expected nil, got %v", result)
	}
}

func TestDeepCopyMap_Empty(t *testing.T) {
	result := deepCopyMap(map[string]interface{}{})
	if result == nil || len(result) != 0 {
		t.Errorf("expected empty map, got %v", result)
	}
}

func TestDeepCopyMap_NestedMaps(t *testing.T) {
	inner := map[string]interface{}{
		"key": "value",
	}
	original := map[string]interface{}{
		"nested": inner,
		"scalar": "hello",
		"number": 42.0,
	}

	copied := deepCopyMap(original)

	// Mutate original nested map
	inner["key"] = "mutated"
	original["scalar"] = "changed"

	// Verify copy is unaffected
	nestedCopy := copied["nested"].(map[string]interface{})
	if nestedCopy["key"] != "value" {
		t.Errorf("nested value was mutated: got %v", nestedCopy["key"])
	}
	if copied["scalar"] != "hello" {
		t.Errorf("scalar value was mutated: got %v", copied["scalar"])
	}
}

func TestDeepCopyMap_NestedSlices(t *testing.T) {
	original := map[string]interface{}{
		"list": []interface{}{
			"a",
			map[string]interface{}{"nested": "in-slice"},
		},
	}

	copied := deepCopyMap(original)

	// Mutate original slice element
	origSlice := original["list"].([]interface{})
	origSlice[0] = "mutated"
	origSlice[1].(map[string]interface{})["nested"] = "mutated"

	// Verify copy is unaffected
	copiedSlice := copied["list"].([]interface{})
	if copiedSlice[0] != "a" {
		t.Errorf("slice element was mutated: got %v", copiedSlice[0])
	}
	nestedInSlice := copiedSlice[1].(map[string]interface{})
	if nestedInSlice["nested"] != "in-slice" {
		t.Errorf("nested map in slice was mutated: got %v", nestedInSlice["nested"])
	}
}

func TestDeepCopyMap_ConcurrentSafe(t *testing.T) {
	// Simulate the actual crash scenario: marshal a deep copy while mutating original
	original := map[string]interface{}{
		"fileName": "test.csv",
		"nested": map[string]interface{}{
			"status": "pending",
		},
	}

	copied := deepCopyMap(original)

	// Mutate original in a goroutine (simulating step execution)
	done := make(chan struct{})
	go func() {
		for i := 0; i < 1000; i++ {
			original["newKey"] = i
			original["nested"].(map[string]interface{})["status"] = "running"
		}
		close(done)
	}()

	// Marshal the copy (simulating StateManager.save)
	for i := 0; i < 1000; i++ {
		_, err := json.Marshal(copied)
		if err != nil {
			t.Fatalf("marshal failed: %v", err)
		}
	}

	<-done
}

func TestDeepCopyValue_ScalarTypes(t *testing.T) {
	tests := []struct {
		name  string
		input interface{}
	}{
		{"string", "hello"},
		{"int", 42},
		{"float64", 3.14},
		{"bool", true},
		{"nil", nil},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := deepCopyValue(tt.input)
			if result != tt.input {
				t.Errorf("expected %v, got %v", tt.input, result)
			}
		})
	}
}
