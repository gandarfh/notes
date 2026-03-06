//go:build tinygo.wasm

package main

import (
	"encoding/json"
	"unsafe"
)

// ── Shared buffers for JS ↔ Go data exchange ───────────────
// TinyGo WASM can only export functions with numeric params.
// JSON protocol: JS writes JSON → buf, Go reads → computes → writes JSON → resultBuf.
// Binary protocol: see binproto.go

const bufSize = 64 * 1024

var buf [bufSize]byte
var resultBuf [bufSize]byte

//export getBuffer
func getBuffer() unsafe.Pointer { return unsafe.Pointer(&buf[0]) }

//export getResultBuffer
func getResultBuffer() unsafe.Pointer { return unsafe.Pointer(&resultBuf[0]) }

// ── JSON dispatch helpers ──────────────────────────────────

// jsonResult marshals any value to the result buffer and returns its length.
func jsonResult(v any) uint32 {
	out, err := json.Marshal(v)
	if err != nil {
		return writeError(err)
	}
	copy(resultBuf[:], out)
	return uint32(len(out))
}

// unmarshal reads the input buffer into a typed struct.
func unmarshal[T any](inputLen uint32) (T, error) {
	var v T
	err := json.Unmarshal(buf[:inputLen], &v)
	return v, err
}

func writeError(err error) uint32 {
	msg := `{"error":"unknown"}`
	if err != nil {
		msg = `{"error":"` + err.Error() + `"}`
	}
	copy(resultBuf[:], msg)
	return uint32(len(msg))
}

func writeBool(v bool) uint32 {
	if v {
		copy(resultBuf[:], "true")
		return 4
	}
	copy(resultBuf[:], "false")
	return 5
}
