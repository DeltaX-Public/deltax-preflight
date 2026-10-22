#!/usr/bin/env node
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createPreflightServer } from '../src/server.mjs';

// stdout belongs exclusively to MCP. The SDK owns framing and connection negotiation.
serveStdio(createPreflightServer);
