# Security Policy

Balloon MCP is an early public alpha. Please report security-sensitive issues responsibly.

## Reporting A Vulnerability

Please do not open a public issue for a security-sensitive report.

Preferred path:

1. use GitHub Private Vulnerability Reporting if it is enabled for the repo
2. otherwise contact the maintainer privately before public disclosure

## Good Security Reports

A useful report should include:

1. what the issue is
2. how to reproduce it
3. what versions or commits are affected
4. what the likely impact is

## Scope Notes

Balloon MCP currently returns analysis artifacts, corrective context, and MCP-facing prompts/resources.

Important areas to review include:

1. MCP transport behavior
2. prompt injection or prompt confusion surfaces
3. state persistence and local data handling
4. correction poisoning or misleading memory reinforcement
5. trust boundaries between host chat agents and Balloon outputs

## Current Security Posture

This alpha should not be presented as:

1. a hardened enterprise security product
2. a provider-level reasoning isolation system
3. a replacement for secure code review or secure deployment processes

It should be treated as an experimental context-fidelity tool with normal open-source caution.
