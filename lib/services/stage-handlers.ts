import "server-only";

// Side-effect-only barrel. Each imported module calls `registerStageHandler`
// at load time. Any code path that reaches `runStage` (the per-stage POST
// routes, the rerun-from route, the run-create orchestrator) must import a
// module that transitively loads this barrel — otherwise the dispatcher
// falls through to the Phase 1.6 stubs and silently no-ops the LLM call.
//
// `lib/services/pipeline.ts` imports this file, which is sufficient since
// every entry point goes through the orchestrator.
import "@/lib/services/competitor";
import "@/lib/services/score";
