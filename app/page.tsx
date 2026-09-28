import dynamic from "next/dynamic";

// This page is entirely client-state (matches/bio/conversation all live in
// localStorage — there is no server-fetched data to preserve via SSR).
// Rendering it client-only lets AssistantApp's initial state be computed
// from localStorage synchronously on first paint (see its useState lazy
// initializers), instead of painting empty and then flashing in the real
// data after a post-mount useEffect. `ssr: false` is what makes that safe:
// with no server-rendered HTML for this component, there is nothing for
// the client's first render to mismatch against.
const AssistantApp = dynamic(() => import("@/components/AssistantApp"), { ssr: false });

export default function Page() {
  return <AssistantApp />;
}
