package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"os/exec"
	"regexp"
	"runtime"
	"strings"
	"sync"
	"time"
)

type toolInfo struct {
	Found   bool   `json:"found"`
	Path    string `json:"path,omitempty"`
	Version string `json:"version,omitempty"`
}

type preflightResult struct {
	OS    string              `json:"os"`
	Arch  string              `json:"arch"`
	Tools map[string]toolInfo `json:"tools"`
}

// fastlane --version boots Ruby (slow) and prints a banner first, so report presence only.
var presenceOnly = map[string]bool{"fastlane": true}

var (
	ansi     = regexp.MustCompile(`\x1b\[[0-9;]*m`)
	toolName = regexp.MustCompile(`^[A-Za-z0-9._-]+$`)
)

func runPreflight(args []string) (any, error) {
	fs := flag.NewFlagSet("preflight", flag.ContinueOnError)
	root := fs.String("root", ".", "project root; version probes run here so yarn resolves the project's version")
	tools := fs.String("tools", "", "comma-separated tool names")
	if err := fs.Parse(args); err != nil {
		return nil, err
	}

	names := splitList(*tools)
	for _, n := range names {
		// A name with a slash would make LookPath treat it as a path to execute.
		if !toolName.MatchString(n) {
			return nil, fmt.Errorf("invalid tool name %q", n)
		}
	}

	res := preflightResult{OS: runtime.GOOS, Arch: runtime.GOARCH, Tools: map[string]toolInfo{}}
	var (
		mu sync.Mutex
		wg sync.WaitGroup
	)
	for _, n := range names {
		wg.Add(1)
		go func(name string) {
			defer wg.Done()
			info := probeTool(name, *root)
			mu.Lock()
			res.Tools[name] = info
			mu.Unlock()
		}(n)
	}
	wg.Wait()
	return res, nil
}

func probeTool(name, dir string) toolInfo {
	path, err := exec.LookPath(name)
	if err != nil {
		return toolInfo{}
	}
	info := toolInfo{Found: true, Path: path}
	if presenceOnly[name] {
		return info
	}

	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, path, "--version")
	cmd.Dir = dir
	// CocoaPods refuses to run (and prints a warning on --version) without a UTF-8 locale.
	cmd.Env = append(os.Environ(), "LANG=en_US.UTF-8", "LC_ALL=en_US.UTF-8")
	out, _ := cmd.CombinedOutput()
	for _, line := range strings.Split(ansi.ReplaceAllString(string(out), ""), "\n") {
		if l := strings.TrimSpace(line); l != "" {
			info.Version = l
			break
		}
	}
	return info
}
