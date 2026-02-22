package main

import (
	"embed"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/menu"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/mac"

	notesApp "notes/internal/app"
)

//go:embed all:frontend/dist
var assets embed.FS

//go:embed build/appicon.png
var icon []byte

func main() {
	app := notesApp.New()

	// macOS needs an Edit menu for Cmd+C/V/X/A to reach the WebView
	appMenu := menu.NewMenu()
	appMenu.Append(menu.EditMenu())

	err := wails.Run(&options.App{
		Title:     "Notes",
		Width:     1440,
		Height:    900,
		MinWidth:  800,
		MinHeight: 600,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour: &options.RGBA{R: 15, G: 15, B: 20, A: 1},
		Menu:             appMenu,
		OnStartup:        app.Startup,
		OnShutdown:       app.Shutdown,
		Bind: []interface{}{
			app,
		},
		Mac: &mac.Options{
			TitleBar: &mac.TitleBar{
				TitlebarAppearsTransparent: true,
				HideTitle:                  true,
				HideTitleBar:               false,
				FullSizeContent:            true,
				UseToolbar:                 true,
				HideToolbarSeparator:       true,
			},
			WebviewIsTransparent: false,
			WindowIsTranslucent:  false,
			About: &mac.AboutInfo{
				Title:   "Notes",
				Message: "Whiteboard-style notebook with Neovim integration",
				Icon:    icon,
			},
		},
	})

	if err != nil {
		println("Error:", err.Error())
	}
}
