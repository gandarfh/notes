//go:build tinygo.wasm

package main

import (
	"notes/internal/plugins/drawing"
	"unsafe"
)

// ── Binary protocol for hot-path 60fps calls ───────────────
// Float64Array-based — no JSON overhead.

const f64BufSize = 8192

var f64Buf [f64BufSize]float64
var f64ResultBuf [f64BufSize]float64

//export getFloat64Buffer
func getFloat64Buffer() unsafe.Pointer { return unsafe.Pointer(&f64Buf[0]) }

//export getFloat64ResultBuffer
func getFloat64ResultBuffer() unsafe.Pointer { return unsafe.Pointer(&f64ResultBuf[0]) }

// BinReader reads float64 values with auto-incrementing position.
type BinReader struct {
	buf []float64
	pos int
}

func newReader() *BinReader { return &BinReader{buf: f64Buf[:], pos: 0} }

func (r *BinReader) F64() float64       { v := r.buf[r.pos]; r.pos++; return v }
func (r *BinReader) Int() int           { return int(r.F64()) }
func (r *BinReader) Bool() bool         { return r.F64() == 1 }
func (r *BinReader) ShapeType() string  { return shapeTypeName(r.Int()) }
func (r *BinReader) Side() string       { return sideName(r.Int()) }
func (r *BinReader) ArrowStyle() string { return arrowStyleName(r.Int()) }

func (r *BinReader) Rect() drawing.Rect {
	return drawing.Rect{X: r.F64(), Y: r.F64(), W: r.F64(), H: r.F64()}
}

func (r *BinReader) OptionalRect() *drawing.Rect {
	if !r.Bool() {
		r.pos += 4
		return nil
	}
	rect := r.Rect()
	return &rect
}

func (r *BinReader) Points() [][2]float64 {
	n := r.Int()
	pts := make([][2]float64, n)
	for i := range pts {
		pts[i] = [2]float64{r.F64(), r.F64()}
	}
	return pts
}

func (r *BinReader) Rects(n int) []drawing.Rect {
	rects := make([]drawing.Rect, n)
	for i := range rects {
		rects[i] = r.Rect()
	}
	return rects
}

// BinWriter writes float64 values with auto-incrementing position.
type BinWriter struct {
	buf []float64
	pos int
}

func newWriter() *BinWriter { return &BinWriter{buf: f64ResultBuf[:], pos: 0} }

func (w *BinWriter) F64(v float64) { w.buf[w.pos] = v; w.pos++ }
func (w *BinWriter) Int(v int)     { w.F64(float64(v)) }
func (w *BinWriter) Bool(v bool) {
	if v {
		w.F64(1)
	} else {
		w.F64(0)
	}
}

func (w *BinWriter) SideId(side string) { w.F64(sideToId(side)) }

func (w *BinWriter) Points(pts [][]float64) {
	w.Int(len(pts))
	for _, pt := range pts {
		w.F64(pt[0])
		w.F64(pt[1])
	}
}

func (w *BinWriter) StrokePaths(paths []drawing.StrokePath) {
	w.Int(len(paths))
	for _, sp := range paths {
		w.Int(len(sp.Cmds))
		w.F64(sp.Opacity)
		w.F64(sp.StrokeWidth)
		var flags float64
		if sp.IsClip {
			flags += 1
		}
		if sp.IsFill {
			flags += 2
		}
		w.F64(flags)
		for _, cmd := range sp.Cmds {
			w.Int(int(cmd.Op))
			w.Int(len(cmd.Args))
			for _, a := range cmd.Args {
				w.F64(a)
			}
		}
	}
}

func (w *BinWriter) Len() float64 { return float64(w.pos) }
