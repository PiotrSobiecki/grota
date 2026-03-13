import { Link } from "@tanstack/react-router";
import type * as React from "react";
import { Footer } from "@/components/landing/footer";
import { NavigationBar } from "@/components/navigation";

interface LegalPageLayoutProps {
	children: React.ReactNode;
}

export function LegalPageLayout({ children }: LegalPageLayoutProps) {
	return (
		<div className="min-h-screen bg-background">
			<NavigationBar />
			<main className="mx-auto max-w-3xl px-6 py-24 lg:px-8">
				<Link
					to="/"
					className="text-sm text-muted-foreground hover:text-foreground transition-colors mb-8 inline-block"
				>
					&larr; Strona glowna
				</Link>
				<article className="prose prose-neutral dark:prose-invert max-w-none">{children}</article>
			</main>
			<Footer />
		</div>
	);
}
