import { createFileRoute, Link } from "@tanstack/react-router";
import { LegalPageLayout } from "@/components/landing/legal-page-layout";

export const Route = createFileRoute("/privacy")({
	component: PrivacyPage,
});

function PrivacyPage() {
	return (
		<LegalPageLayout>
			<h1>Polityka Prywatnosci</h1>
			<p className="text-muted-foreground text-sm">Ostatnia aktualizacja: 13 marca 2026 r.</p>

			<h2>Kto jest administratorem danych?</h2>
			<p>Administratorem danych osobowych jest Auditmos, operator serwisu Grota.</p>

			<h2>W jakim celu przetwarzamy dane?</h2>
			<ul>
				<li>
					Swiadczenie uslugi zarzadzania srodowiskiem Google Workspace (onboarding, backup,
					reorganizacja dostepu, archiwizacja)
				</li>
				<li>Tworzenie i przechowywanie kopii zapasowych danych Organizacji</li>
				<li>Monitorowanie bezpieczenstwa i integralnosci platformy</li>
				<li>Analiza uzytkowania w celu ulepszania uslugi</li>
				<li>Kontakt z Uzytkownikami w sprawach dotyczacych ich kont i Organizacji</li>
			</ul>

			<h2>Jakie dane przetwarzamy?</h2>
			<ul>
				<li>
					<strong>Dane konta:</strong> adres e-mail, imie i nazwisko (z konta Google)
				</li>
				<li>
					<strong>Dane Google Workspace:</strong> struktura organizacyjna, uprawnienia dostepu,
					konfiguracja kont &mdash; w zakresie niezbednym do swiadczenia uslugi
				</li>
				<li>
					<strong>Dane techniczne:</strong> adres IP, typ przegladarki, statystyki odwiedzin
				</li>
				<li>
					<strong>Pliki cookie:</strong> wylacznie niezbedne dla funkcjonowania serwisu (sesja,
					uwierzytelnianie)
				</li>
			</ul>

			<h2>Jakie dane udostepniamy?</h2>
			<p>Dane osobowe nie sa sprzedawane. Udostepnianie zachodzi wylacznie dla:</p>
			<ul>
				<li>
					Dostawcow infrastruktury (Cloudflare) &mdash; w zakresie niezbednym do hostowania uslugi
				</li>
				<li>Backblaze B2 &mdash; przechowywanie zaszyfrowanych kopii zapasowych</li>
				<li>Organow regulacyjnych, jesli wymaga tego prawo</li>
			</ul>

			<h2>Jak dlugo przechowujemy dane?</h2>
			<ul>
				<li>Dane konta &mdash; przez czas korzystania z Serwisu i do 30 dni po usunieciu konta</li>
				<li>Kopie zapasowe &mdash; zgodnie z polityka retencji ustawiona przez Organizacje</li>
				<li>Logi techniczne &mdash; do 90 dni w celach analitycznych i bezpieczenstwa</li>
			</ul>

			<h2>Podstawy prawne przetwarzania</h2>
			<ul>
				<li>
					<strong>Wykonanie umowy</strong> (art. 6 ust. 1 lit. b RODO) &mdash; przetwarzanie niezbedne
					do swiadczenia uslugi
				</li>
				<li>
					<strong>Prawnie uzasadniony interes</strong> (art. 6 ust. 1 lit. f RODO) &mdash;
					bezpieczenstwo, analityka, ulepszanie uslugi
				</li>
			</ul>

			<h2>Prawa uzytkownikow</h2>
			<p>Kazdy Uzytkownik moze zadac:</p>
			<ul>
				<li>Dostepu do swoich danych</li>
				<li>Sprostowania nieprawidlowych informacji</li>
				<li>Usuniecia danych (prawo do bycia zapomnianym)</li>
				<li>Ograniczenia przetwarzania</li>
				<li>Przeniesienia danych</li>
				<li>Sprzeciwu wobec przetwarzania</li>
			</ul>
			<p>
				Zadania mozna zglaszac poprzez formularz kontaktowy w Serwisie lub bezposrednio na adres e-mail
				Operatora.
			</p>

			<h2>Bezpieczenstwo</h2>
			<ul>
				<li>Transmisja szyfrowana HTTPS/TLS</li>
				<li>Dane w spoczynku szyfrowane AES-256</li>
				<li>Kopie zapasowe zgodne z zasada 3-2-1 (3 kopie, 2 media, 1 offsite)</li>
				<li>Infrastruktura na serwerach Cloudflare</li>
				<li>Naruszenia bezpieczenstwa zglaszane odpowiednim organom w ciagu 72 godzin</li>
			</ul>

			<h2>Pliki cookie</h2>
			<p>
				Stosowane wylacznie niezbedne pliki cookie (sesja, uwierzytelnianie). Brak plikow sledzacych i
				marketingowych.
			</p>

			<h2>Kontakt i skargi</h2>
			<p>
				Pytania dotyczace prywatnosci mozna kierowac przez formularz kontaktowy w Serwisie. Uzytkownicy
				maja prawo zlozenia skargi do Prezesa Urzedu Ochrony Danych Osobowych (PUODO).
			</p>

			<p className="text-muted-foreground text-sm mt-12">
				Zobacz takze:{" "}
				<Link to="/terms" className="text-primary hover:underline">
					Regulamin
				</Link>
			</p>
		</LegalPageLayout>
	);
}
