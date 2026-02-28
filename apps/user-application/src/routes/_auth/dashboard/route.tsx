import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_auth/dashboard")({
	component: DashboardLayout,
});

function DashboardLayout() {
	return (
		<div className="space-y-6">
			<Outlet />
		</div>
	);
}
