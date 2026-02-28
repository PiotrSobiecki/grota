import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_auth/dashboard/")({
	component: DashboardIndex,
});

function DashboardIndex() {
	return (
		<div className="space-y-4">
			<h1 className="text-2xl font-bold text-foreground">Panel operatora</h1>
			<p className="text-muted-foreground">Brak wdrozen. Utworz nowe wdrozenie aby rozpoczac.</p>
		</div>
	);
}
