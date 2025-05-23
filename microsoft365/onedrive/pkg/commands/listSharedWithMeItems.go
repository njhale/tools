package commands

import (
	"context"
	"fmt"

	"github.com/gptscript-ai/go-gptscript"
	"github.com/obot-platform/tools/microsoft365/onedrive/pkg/client"
	"github.com/obot-platform/tools/microsoft365/onedrive/pkg/global"
	"github.com/obot-platform/tools/microsoft365/onedrive/pkg/graph"
	"github.com/obot-platform/tools/microsoft365/onedrive/pkg/util"
)

func ListSharedWithMeItems(ctx context.Context) error {
	c, err := client.NewClient(global.AllScopes)
	if err != nil {
		return fmt.Errorf("failed to create client: %w", err)
	}

	items, err := graph.ListSharedWithMeDriveItems(ctx, c)
	if err != nil {
		return fmt.Errorf("failed to list shared items: %w", err)
	}

	gptscriptClient, err := gptscript.NewGPTScript()
	if err != nil {
		return fmt.Errorf("failed to create GPTScript client: %w", err)
	}

	var elements []gptscript.DatasetElement
	for _, item := range items {
		itemStr := ""
		itemStr += fmt.Sprintf("FileName: %s\n", util.Deref(item.GetName()))

		itemStr += fmt.Sprintf("Item ID: %s\n", util.Deref(item.GetId()))

		if remoteItem := item.GetRemoteItem(); remoteItem != nil {
			if parentRef := remoteItem.GetParentReference(); parentRef != nil {
				if parentDriveID := parentRef.GetDriveId(); parentDriveID != nil {
					itemStr += fmt.Sprintf("Drive ID: %s\n", util.Deref(parentDriveID))
				}
			}
		}

		if webUrl := item.GetWebUrl(); webUrl != nil {
			itemStr += fmt.Sprintf("Web URL: %s\n", util.Deref(webUrl))
		}
		elements = append(elements, gptscript.DatasetElement{
			DatasetElementMeta: gptscript.DatasetElementMeta{
				Name:        util.Deref(item.GetId()),
				Description: util.Deref(item.GetName()),
			},
			Contents: itemStr,
		})
	}

	if len(elements) == 0 {
		fmt.Println("No shared items found")
		return nil
	}

	datasetID, err := gptscriptClient.CreateDatasetWithElements(ctx, elements, gptscript.DatasetOptions{
		Name:        "onedrive_shared_item",
		Description: "Shared items in OneDrive",
	})
	if err != nil {
		return fmt.Errorf("failed to create dataset with elements: %w", err)
	}

	fmt.Printf("Created dataset with ID %s with %d shared items\n", datasetID, len(items))

	return nil
}
