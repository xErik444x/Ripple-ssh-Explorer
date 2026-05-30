package app

import (
	"github.com/wailsapp/wails/v3/pkg/application"
)

func (a *App) ShowSaveDialog(defaultName string) (string, error) {
	result, err := a.app.Dialog.SaveFileWithOptions(&application.SaveFileDialogOptions{
		Filename: defaultName,
	}).PromptForSingleSelection()
	if err != nil {
		return "", err
	}
	return result, nil
}

func (a *App) ShowOpenDialog() (string, error) {
	result, err := a.app.Dialog.OpenFileWithOptions(&application.OpenFileDialogOptions{}).PromptForSingleSelection()
	if err != nil {
		return "", err
	}
	return result, nil
}

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

	<-done
	return result
}
