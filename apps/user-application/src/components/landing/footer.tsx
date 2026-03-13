import { Link } from "@tanstack/react-router";

export function Footer() {
	return (
		<footer className="border-t bg-background">
			<div className="mx-auto max-w-7xl px-6 py-12 lg:px-8">
				<div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
					<div>
						<p className="text-sm font-semibold text-foreground">Grota</p>
						<p className="text-xs text-muted-foreground mt-1">
							Google Reorganize, Onboard, Transfer, Archive
						</p>
					</div>
					<div className="flex flex-col md:flex-row md:items-center gap-4">
						<nav className="flex gap-4">
							<Link
								to="/terms"
								className="text-xs text-muted-foreground hover:text-foreground transition-colors"
							>
								Regulamin
							</Link>
							<Link
								to="/privacy"
								className="text-xs text-muted-foreground hover:text-foreground transition-colors"
							>
								Polityka prywatnosci
							</Link>
						</nav>
						<p className="text-xs text-muted-foreground">
							&copy; {new Date().getFullYear()}{" "}
							<a
								href="https://auditmos.com"
								target="_blank"
								rel="noopener noreferrer"
								className="hover:text-foreground transition-colors"
							>
								Auditmos OU
							</a>
							. Wszelkie prawa zastrzezone.
						</p>
					</div>
				</div>
			</div>
		</footer>
	);
}
