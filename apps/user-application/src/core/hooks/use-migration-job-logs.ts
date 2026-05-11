import { useEffect, useRef, useState } from "react";

export interface MigrationLogLine {
	ts: string;
	stream: "stdout" | "stderr";
	line: string;
}

export interface MigrationLogState {
	lines: MigrationLogLine[];
	connected: boolean;
	error: string | null;
}

const MAX_LINES = 5000;

export function useMigrationJobLogs(
	jobId: string | null,
	/** false po zakonczeniu joba — zamykamy SSE, nie laczymy ponownie, nie doklejamy replayu */
	streamLogs = true,
): MigrationLogState {
	const [state, setState] = useState<MigrationLogState>({
		lines: [],
		connected: false,
		error: null,
	});
	const sourceRef = useRef<EventSource | null>(null);
	/** Liczba onopen na tym EventSource — >1 oznacza reconnect; runner wysyla caly replay od zera (inaczej linie sie duplikuja). */
	const openCountRef = useRef(0);
	const prevJobIdRef = useRef<string | null>(null);

	useEffect(() => {
		if (!jobId) {
			prevJobIdRef.current = null;
			setState({ lines: [], connected: false, error: null });
			return;
		}

		const jobIdChanged = prevJobIdRef.current !== jobId;

		if (!streamLogs) {
			setState((s) => ({
				lines: jobIdChanged ? [] : s.lines,
				connected: false,
				error: null,
			}));
			prevJobIdRef.current = jobId;
			return;
		}

		prevJobIdRef.current = jobId;
		openCountRef.current = 0;
		const es = new EventSource(`/api/migration/jobs/${jobId}/logs/stream`);
		sourceRef.current = es;
		setState({ lines: [], connected: false, error: null });

		const onLine = (ev: MessageEvent) => {
			try {
				const parsed = JSON.parse(ev.data) as MigrationLogLine;
				setState((s) => {
					const next = [...s.lines, parsed];
					if (next.length > MAX_LINES) next.splice(0, next.length - MAX_LINES);
					return { ...s, lines: next };
				});
			} catch {
				// ignore malformed
			}
		};

		es.onopen = () => {
			openCountRef.current += 1;
			const isReconnect = openCountRef.current > 1;
			setState((s) => ({
				lines: isReconnect ? [] : s.lines,
				connected: true,
				error: null,
			}));
		};
		es.onerror = () => setState((s) => ({ ...s, connected: false, error: "Polaczenie przerwane" }));
		// Runner (Hono streamSSE) wysyla `event: log` — wtedy onmessage NIE dostaje zdarzenia (tylko typ "message").
		es.addEventListener("log", onLine);
		es.addEventListener("message", onLine);

		return () => {
			es.removeEventListener("log", onLine);
			es.removeEventListener("message", onLine);
			es.close();
			sourceRef.current = null;
		};
	}, [jobId, streamLogs]);

	return state;
}
