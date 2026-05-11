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

export function useMigrationJobLogs(jobId: string | null): MigrationLogState {
	const [state, setState] = useState<MigrationLogState>({
		lines: [],
		connected: false,
		error: null,
	});
	const sourceRef = useRef<EventSource | null>(null);

	useEffect(() => {
		if (!jobId) {
			setState({ lines: [], connected: false, error: null });
			return;
		}
		const es = new EventSource(`/api/migration/jobs/${jobId}/logs/stream`);
		sourceRef.current = es;
		setState({ lines: [], connected: false, error: null });

		es.onopen = () => setState((s) => ({ ...s, connected: true, error: null }));
		es.onerror = () => setState((s) => ({ ...s, connected: false, error: "Polaczenie przerwane" }));
		es.onmessage = (ev) => {
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

		return () => {
			es.close();
			sourceRef.current = null;
		};
	}, [jobId]);

	return state;
}
