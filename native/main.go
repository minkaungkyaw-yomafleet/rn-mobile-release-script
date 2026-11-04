// rnmrs-core is the native half of rnmrs. The Bun CLI owns prompts and orchestration;
// this binary owns the I/O-heavy work (parallel cleaning, tool probing, Fastfile parsing).
//
// Contract: every subcommand prints exactly one JSON document to stdout and exits 0,
// or prints one line to stderr and exits 1. Secret values never appear in output.
package main

import (
	"encoding/json"
	"fmt"
	"os"
)

// protocolVersion lets the JS side refuse a stale binary after a breaking output change.
const protocolVersion = 1

func main() {
	if len(os.Args) < 2 {
		fail(fmt.Errorf("usage: rnmrs-core <version|preflight|clean|envcheck|lanes|fastlane-env> [flags]"))
	}
	cmd, args := os.Args[1], os.Args[2:]

	var (
		out any
		err error
	)
	switch cmd {
	case "version":
		out = map[string]int{"protocol": protocolVersion}
	case "preflight":
		out, err = runPreflight(args)
	case "clean":
		out, err = runClean(args)
	case "envcheck":
		out, err = runEnvCheck(args)
	case "lanes":
		out, err = runLanes(args)
	case "fastlane-env":
		out, err = runFastlaneEnv(args)
	default:
		err = fmt.Errorf("unknown command %q", cmd)
	}
	if err != nil {
		fail(err)
	}
	if err := json.NewEncoder(os.Stdout).Encode(out); err != nil {
		fail(err)
	}
}

func fail(err error) {
	fmt.Fprintln(os.Stderr, "rnmrs-core: "+err.Error())
	os.Exit(1)
}
