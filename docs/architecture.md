# pi-agent-memory — Architecture

> System topology: where memory lives, how agents access it, how sync flows.

## Full System

```mermaid
graph TB
    subgraph Interfaces["Agent Interfaces"]
        TELEGRAM["Telegram Bot"]
        SLACK["Slack"]
        WHATSAPP["WhatsApp"]
        PI_TUI["Pi TUI<br/>(Thor)"]
    end

    subgraph AgentRuntime["Agent Runtime (Server)"]
        AGENT["Agent Process<br/>(Pi headless or standalone)"]
        MEM_EXT["pi-agent-memory<br/>Extension"]
        LOCAL_MEM["Local Memory<br/>~/.pi/agents/&lt;name&gt;/memory/"]
    end

    subgraph MemoryServer["pi-agent-memory-server"]
        MEMFS["memfs Git HTTP<br/>Bare repos"]
        REMOTE_MEM["Remote Memory<br/>git:// agent repos"]
    end

    subgraph DeviceB["Device B (e.g. X220)"]
        AGENT_B["Agent Process"]
        LOCAL_MEM_B["Local Memory<br/>(clone of remote)"]
    end

    subgraph Projects["Project Memory"]
        PROJ_A[".memory/<br/>Project A"]
        PROJ_B[".memory/<br/>Project B"]
    end

    subgraph Archival["Archival Search"]
        VECTOR["Vector Store<br/>SQLite + embeddings"]
        SEM_SEARCH["semantic_search()"]
    end

    TELEGRAM --> AGENT
    SLACK --> AGENT
    WHATSAPP --> AGENT
    PI_TUI --> AGENT

    AGENT --> MEM_EXT
    MEM_EXT --> LOCAL_MEM
    MEM_EXT --> PROJ_A
    MEM_EXT --> PROJ_B
    MEM_EXT --> SEM_SEARCH
    VECTOR --> SEM_SEARCH

    LOCAL_MEM <-->|"git push/pull"| MEMFS
    LOCAL_MEM_B <-->|"git push/pull"| MEMFS
    AGENT_B --> LOCAL_MEM_B

    PROJ_A -.->|"local only<br/>no remote"| PROJ_A
    PROJ_B -.->|"local only<br/>no remote"| PROJ_B
```

## Zones

```mermaid
graph LR
    subgraph ZoneA["Zone A — Agent Memory"]
        direction TB
        SYSTEM["system/<br/>persona, human, projects<br/>(always in context)"]
        REF["reference/<br/>(lazy load)"]
    end

    subgraph ZoneB["Zone B — Project Memory"]
        direction TB
        PROJ_MEM[".memory/<br/>status, decisions,<br/>observations"]
        ARCHIVE["archive/<br/>vector store"]
    end

    subgraph ZoneC["Zone C — Sessions"]
        SESSIONS[".pi/sessions/<br/>JSONL logs"]
    end

    AGENT_PROCESS["Agent"] -->|"injected each turn"| SYSTEM
    AGENT_PROCESS -->|"memory_read()"| REF
    AGENT_PROCESS -->|"memory_read() via root"| PROJ_MEM
    AGENT_PROCESS -->|"memory_archive_search()"| ARCHIVE
    AGENT_PROCESS -->|"memory_recall()"| SESSIONS
```

## Sync Flow

```mermaid
sequenceDiagram
    participant D1 as Device A (Thor)
    participant S as pi-memory-server
    participant D2 as Device B (X220)

    Note over D1: memory_write("system/observation.md")
    D1->>D1: git commit
    D1->>S: git push (auto or manual)

    Note over D2: Agent starts
    D2->>S: git pull
    D2->>D2: Load updated system/ files

    Note over D1: memory_read("reference/bttn/status.md")
    D1->>D1: Read from local disk (~1ms)
```

Key design constraint: reads are always local (fast). Writes commit locally then optionally push. Pulls happen on session start or explicitly. No remote calls during normal tool use.

## Telegram User Journey 1 — Task Capture

```mermaid
sequenceDiagram
    participant SAN as San (on farm, mobile)
    participant TG as Telegram
    participant AGENT as Agent (server)
    participant MEM as Memory System
    participant GH as GitHub

    SAN->>TG: 📸 photo + "Rootstock sucker on apple tree — needs pruning"
    TG->>AGENT: Forward message
    AGENT->>MEM: memory_read("reference/farm/status.md")
    AGENT->>GH: Create issue "Prune apple rootstock sucker"
    AGENT->>MEM: memory_write("reference/farm/observations/", issue link)
    AGENT->>TG: "✅ Issue #47 created. Added to farm log."
    TG->>SAN: Display response
```

## Telegram User Journey 2 — Donor Query

```mermaid
sequenceDiagram
    participant SAN as San (idea strikes)
    participant TG as Telegram
    participant AGENT as Agent (server)
    participant MEM as Memory System
    participant CRM as HeavenCRM

    SAN->>TG: "When did Kim O Bok last donate?"
    TG->>AGENT: Forward query
    AGENT->>MEM: memory_read("reference/heavencrm/status.md")
    AGENT->>CRM: Query donation DB
    CRM-->>AGENT: "2026-03-14, $25"
    AGENT->>TG: "Kim O Bok last donated Mar 14, 2026 — $25."
    TG->>SAN: Display
    SAN->>TG: "Send him a thank you note"
    TG->>AGENT: Forward
    AGENT->>CRM: Draft thank-you via agent pipeline
    AGENT->>TG: "✅ Draft ready for review."
```

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| Reads always local, writes commit-then-push | Memory tools must be fast (~1ms). No network dependency for reads. |
| Git as sync protocol | No custom wire format. Works with any git remote (GitHub, memfs, bare repo). |
| Zone B repos never have remotes | Project memory stays local. Sensitive strategy docs don't leave the device. |
| Agent runs on server, not device | Mobile is an interface, not a runtime. Zero memory complexity on the phone. |
| Archival search via tools, not auto-index | Explicit store/query keeps the archive intentional. Avoids indexing noise. |
| pi-agent-memory-server is a separate project | Git over HTTP is the contract. The server is one implementation. Replaceable. |
