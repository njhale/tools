package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"strings"

	"github.com/obot-platform/obot/apiclient"
	"github.com/obot-platform/obot/apiclient/types"
	"github.com/obot-platform/obot/pkg/system"
)

var (
	url            = os.Getenv("OBOT_SERVER_URL")
	token          = os.Getenv("OBOT_TOKEN")
	threadID       = os.Getenv("OBOT_THREAD_ID")
	parentThreadID = os.Getenv("OBOT_PARENT_THREAD_ID")
	assistantID    = os.Getenv("OBOT_AGENT_ID")
	content        = os.Getenv("CONTENT")
)

func main() {
	ctx := context.Background()
	if err := mainErr(ctx); err != nil {
		slog.Error("error", "err", err)
		os.Exit(1)
	}
}

func add(ctx context.Context, c *apiclient.Client, projectID, content string) error {
	if content == "" {
		return fmt.Errorf("missing content to remember")
	}

	fmt.Printf("adding memory. project id: %s, assistant id: %s, content: %q\n", projectID, assistantID, content)

	result, err := c.AddMemories(ctx, assistantID, projectID, types.Memory{
		Content: content,
	})
	if err != nil {
		return fmt.Errorf("failed to add memory: %v", err)
	}

	fmt.Printf("memory added. id: %s\n", result.ID)

	return json.NewEncoder(os.Stdout).Encode(result)
}

func list(ctx context.Context, c *apiclient.Client, projectID string) error {
	result, err := c.GetMemories(ctx, assistantID, projectID)
	if err != nil {
		return fmt.Errorf("get memory: %v", err)
	}

	return json.NewEncoder(os.Stdout).Encode(result)
}

func delete(ctx context.Context, c *apiclient.Client, projectID string) error {
	err := c.DeleteMemories(ctx, assistantID, projectID)
	if err != nil {
		return fmt.Errorf("failed to delete memories: %v", err)
	}

	fmt.Println("memories deleted")
	return nil
}

func mainErr(ctx context.Context) error {
	var projectID string
	if parentThreadID != "" {
		projectID = strings.Replace(parentThreadID, system.ThreadPrefix, system.ProjectPrefix, 1)
	} else if threadID != "" {
		projectID = strings.Replace(threadID, system.ThreadPrefix, system.ProjectPrefix, 1)
	}

	if projectID == "" {
		return fmt.Errorf("missing project id")
	}

	if len(os.Args) == 1 {
		fmt.Printf("incorrect usage: %s [add|list|delete]\n", os.Args[0])
		return nil
	}

	if url == "" {
		url = "http://localhost:8080/api"
	} else {
		url += "/api"
	}

	client := &apiclient.Client{
		BaseURL: url,
		Token:   token,
	}

	switch os.Args[1] {
	case "add":
		return add(ctx, client, projectID, content)
	case "list":
		return list(ctx, client, projectID)
	case "delete":
		return delete(ctx, client, projectID)
	}

	return nil
}
