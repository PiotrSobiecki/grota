import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
	getEmployeesByDeployment,
	resendEmployeeMagicLink,
} from "@/core/functions/employees/binding";
import { verifyAdminToken } from "@/core/functions/magic-links/binding";

export const Route = createFileRoute("/status/$token")({
	loader: ({ params }) => verifyAdminToken({ data: { token: params.token } }),
	component: StatusPage,
});

const OAUTH_STATUS_LABELS: Record<
	string,
	{ label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
	pending: { label: "Oczekuje", variant: "secondary" },
	authorized: { label: "Autoryzowany", variant: "default" },
	failed: { label: "Blad", variant: "destructive" },
};

const RATE_LIMIT_MS = 5 * 60 * 1000; // 5 minutes

function StatusPage() {
	const loaderData = Route.useLoaderData();
	const { deploymentId } = loaderData;

	const employeesQuery = useQuery({
		queryKey: ["employees", deploymentId],
		queryFn: () => getEmployeesByDeployment({ data: { deploymentId } }),
		refetchInterval: 30_000,
	});

	const employees = employeesQuery.data?.data ?? [];
	const total = employeesQuery.data?.total ?? 0;
	const completedCount = employees.filter((e) => e.oauthStatus === "authorized").length;

	return (
		<div className="min-h-screen bg-background p-6">
			<div className="max-w-2xl mx-auto space-y-6">
				<h1 className="text-2xl font-bold text-foreground">Status onboardingu</h1>

				{/* Summary card */}
				<Card>
					<CardHeader>
						<CardTitle>Postep</CardTitle>
					</CardHeader>
					<CardContent>
						{employeesQuery.isPending ? (
							<div className="flex items-center gap-2 text-muted-foreground">
								<Loader2 className="h-4 w-4 animate-spin" />
								Ladowanie...
							</div>
						) : (
							<p className="text-lg text-foreground">
								<span className="font-bold">{completedCount}</span>/{total} pracownikow ukonczylo
								autoryzacje
							</p>
						)}
					</CardContent>
				</Card>

				{/* Employee list */}
				{employeesQuery.data && (
					<Card>
						<CardHeader>
							<CardTitle>Pracownicy</CardTitle>
						</CardHeader>
						<CardContent>
							{employees.length === 0 ? (
								<p className="text-muted-foreground">Brak pracownikow.</p>
							) : (
								<div className="space-y-3">
									{employees.map((employee) => (
										<EmployeeStatusRow key={employee.id} employee={employee} />
									))}
								</div>
							)}
						</CardContent>
					</Card>
				)}
			</div>
		</div>
	);
}

interface EmployeeStatusRowProps {
	employee: {
		id: string;
		name: string;
		email: string;
		oauthStatus: string;
		magicLinkSentAt: string | Date | null;
	};
}

function EmployeeStatusRow({ employee }: EmployeeStatusRowProps) {
	const statusInfo = OAUTH_STATUS_LABELS[employee.oauthStatus] ?? {
		label: employee.oauthStatus,
		variant: "outline" as const,
	};

	const resendMutation = useMutation({
		mutationFn: () => resendEmployeeMagicLink({ data: { employeeId: employee.id } }),
	});

	const isRateLimited = (() => {
		if (!employee.magicLinkSentAt) return false;
		const sentAt = new Date(employee.magicLinkSentAt).getTime();
		return Date.now() - sentAt < RATE_LIMIT_MS;
	})();

	return (
		<div className="flex items-center justify-between rounded-md border border-border p-3">
			<div className="space-y-1">
				<p className="text-sm font-medium text-foreground">{employee.name}</p>
				<p className="text-xs text-muted-foreground">{employee.email}</p>
			</div>
			<div className="flex items-center gap-3">
				<Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>
				{employee.oauthStatus !== "authorized" && (
					<Button
						variant="outline"
						size="sm"
						onClick={() => resendMutation.mutate()}
						disabled={resendMutation.isPending || isRateLimited}
						title={isRateLimited ? "Mozna wyslac ponownie za 5 minut" : "Wyslij link ponownie"}
					>
						{resendMutation.isPending ? (
							<Loader2 className="h-3 w-3 animate-spin" />
						) : (
							<>
								<RefreshCw className="mr-1 h-3 w-3" />
								Wyslij ponownie
							</>
						)}
					</Button>
				)}
			</div>
			{resendMutation.isError && (
				<p className="mt-1 w-full text-xs text-destructive">{resendMutation.error.message}</p>
			)}
		</div>
	);
}
