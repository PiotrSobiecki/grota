import { useNavigate, useRouterState } from "@tanstack/react-router";
import { Home, LogOut, Menu, Rocket } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

interface NavigationItem {
	name: string;
	icon: React.ComponentType<{ className?: string }>;
	href: string;
	badge?: string | number;
}

const navigationItems: NavigationItem[] = [
	{
		name: "Strona glowna",
		icon: Home,
		href: "/",
	},
	{
		name: "Wdrozenia",
		icon: Rocket,
		href: "/dashboard",
	},
];

interface SidebarProps {
	className?: string;
	mobileOpen?: boolean;
	onMobileOpenChange?: (open: boolean) => void;
}

export function Sidebar({ className, mobileOpen, onMobileOpenChange }: SidebarProps) {
	const navigate = useNavigate();
	const routerState = useRouterState();
	const currentPath = routerState.location.pathname;
	const [isCollapsed, setIsCollapsed] = useState(false);

	return (
		<>
			{/* Desktop Sidebar */}
			<div
				className={cn(
					"hidden lg:flex lg:flex-col lg:border-r lg:border-border lg:bg-background",
					isCollapsed ? "lg:w-16" : "lg:w-64",
					"transition-all duration-300 ease-in-out",
					className,
				)}
			>
				<div className="flex h-16 items-center justify-between px-6 border-b border-border">
					{!isCollapsed && (
						<h1 className="text-xl font-semibold tracking-tight text-foreground">Grota</h1>
					)}
					<Button
						variant="ghost"
						size="icon"
						onClick={() => setIsCollapsed(!isCollapsed)}
						className="h-8 w-8"
					>
						<Menu className="h-4 w-4 text-foreground" />
					</Button>
				</div>

				<ScrollArea className="flex-1 px-3 py-4">
					<nav className="space-y-2">
						{navigationItems.map((item) => {
							const isActive =
								currentPath === item.href ||
								(item.href !== "/dashboard" && currentPath.startsWith(item.href));

							return (
								<Button
									key={item.name}
									variant={isActive ? "default" : "ghost"}
									className={cn(
										"w-full justify-start gap-3 h-10",
										isCollapsed && "px-2 justify-center",
										isActive && "bg-primary text-primary-foreground shadow-sm",
										!isActive && "text-muted-foreground hover:text-foreground hover:bg-accent",
									)}
									onClick={() => navigate({ to: item.href })}
								>
									<item.icon className="h-4 w-4 flex-shrink-0" />
									{!isCollapsed && (
										<>
											<span className="truncate">{item.name}</span>
											{item.badge && (
												<span className="ml-auto flex h-5 w-5 items-center justify-center rounded-full bg-primary text-xs font-medium text-primary-foreground">
													{item.badge}
												</span>
											)}
										</>
									)}
								</Button>
							);
						})}
					</nav>
				</ScrollArea>
			</div>

			{/* Mobile Sidebar */}
			<Sheet open={mobileOpen} onOpenChange={onMobileOpenChange}>
				<SheetContent side="left" className="w-64 p-0" aria-describedby={undefined}>
					<SheetHeader className="h-16 flex-row items-center justify-between px-6 border-b border-border">
						<SheetTitle className="text-xl font-semibold tracking-tight">Grota</SheetTitle>
					</SheetHeader>
					<ScrollArea className="flex-1 px-3 py-4">
						<nav className="space-y-2">
							{navigationItems.map((item) => {
								const isActive =
									currentPath === item.href ||
									(item.href !== "/dashboard" && currentPath.startsWith(item.href));
								return (
									<Button
										key={item.name}
										variant={isActive ? "default" : "ghost"}
										className={cn(
											"w-full justify-start gap-3 h-10",
											isActive && "bg-primary text-primary-foreground shadow-sm",
											!isActive && "text-muted-foreground hover:text-foreground hover:bg-accent",
										)}
										onClick={() => {
											navigate({ to: item.href });
											onMobileOpenChange?.(false);
										}}
									>
										<item.icon className="h-4 w-4 flex-shrink-0" />
										<span className="truncate">{item.name}</span>
									</Button>
								);
							})}
						</nav>
					</ScrollArea>
					<MobileSheetFooter onClose={() => onMobileOpenChange?.(false)} />
				</SheetContent>
			</Sheet>
		</>
	);
}

function MobileSheetFooter({ onClose }: { onClose: () => void }) {
	const session = authClient.useSession();
	const navigate = useNavigate();

	if (!session.data) return null;

	return (
		<SheetFooter className="border-t border-border p-4">
			<p className="text-sm text-muted-foreground truncate">{session.data.user.email}</p>
			<Button
				variant="ghost"
				className="w-full justify-start gap-3 text-muted-foreground hover:text-foreground"
				onClick={async () => {
					await authClient.signOut();
					onClose();
					navigate({ to: "/" });
				}}
			>
				<LogOut className="h-4 w-4" />
				<span>Wyloguj sie</span>
			</Button>
		</SheetFooter>
	);
}
