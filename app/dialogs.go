package app

import (
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// ShowSaveDialog opens a native save file dialog.
func (a *App) ShowSaveDialog(defaultName string) (string, error) {
	result, err := a.app.Dialog.SaveFileWithOptions(&application.SaveFileDialogOptions{
		Filename: defaultName,
	}).PromptForSingleSelection()
	if err != nil {
		return "", err
	}
	return result, nil
}

// ShowOpenDialog opens a native file open dialog.
func (a *App) ShowOpenDialog() (string, error) {
	result, err := a.app.Dialog.OpenFileWithOptions(&application.OpenFileDialogOptions{}).PromptForSingleSelection()
	if err != nil {
		return "", err
	}
	return result, nil
}

// ShowMessage shows a native dialog with Yes/No buttons and returns the choice.
// Returns "No" if the dialog is dismissed or times out after 5 minutes.
func (a *App) ShowMessage(title, message string) string {
	var result string
	done := make(chan struct{})

	dialog := a.app.Dialog.Question().
		SetTitle(title).
		SetMessage(message)

	dialog.AddButton("Yes").OnClick(func() {
		result = "Yes"
		close(done)
	})

	dialog.AddButton("No").OnClick(func() {
		result = "No"
		close(done)
	})

	dialog.Show()

	select {
	case <-done:
	case <-time.After(5 * time.Minute):
		result = "No"
	}

	return result
}
