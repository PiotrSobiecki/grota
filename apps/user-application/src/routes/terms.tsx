import { createFileRoute, Link } from "@tanstack/react-router";
import { LegalPageLayout } from "@/components/landing/legal-page-layout";

export const Route = createFileRoute("/terms")({
	component: TermsPage,
});

function TermsPage() {
	return (
		<LegalPageLayout>
			<h1>Regulamin serwisu Grota</h1>
			<p className="text-muted-foreground text-sm">Ostatnia aktualizacja: 13 marca 2026 r.</p>

			<p>
				Niniejszy regulamin okresla zasady korzystania z serwisu Grota (dalej &ldquo;Serwis&rdquo;),
				udostepnianego przez Auditmos (dalej &ldquo;Operator&rdquo;). Korzystanie z Serwisu oznacza
				akceptacje ponizszych warunkow.
			</p>

			<h2>1. Definicje</h2>
			<ol>
				<li>
					<strong>&ldquo;Serwis&rdquo;</strong> &mdash; platforma Grota sluzaca do zarzadzania
					srodowiskiem Google Workspace: onboarding, backup, reorganizacja dostepu i archiwizacja.
				</li>
				<li>
					<strong>&ldquo;Uzytkownik&rdquo;</strong> &mdash; osoba korzystajaca z Serwisu, w tym
					administrator Google Workspace organizacji bedacej klientem.
				</li>
				<li>
					<strong>&ldquo;Organizacja&rdquo;</strong> &mdash; podmiot, ktorego srodowisko Google
					Workspace jest zarzadzane za posrednictwem Serwisu.
				</li>
				<li>
					<strong>&ldquo;Dane&rdquo;</strong> &mdash; informacje przetwarzane w ramach Serwisu, w
					tym dane z Google Workspace Organizacji.
				</li>
			</ol>

			<h2>2. Charakter serwisu</h2>
			<ol>
				<li>
					Serwis umozliwia zarzadzanie srodowiskiem Google Workspace, w szczegolnosci: onboarding
					nowych uzytkownikow, tworzenie kopii zapasowych (backup 3-2-1), reorganizacje uprawnien
					dostepu oraz archiwizacje kont.
				</li>
				<li>
					Korzystanie z Serwisu wymaga rejestracji i autoryzacji dostepu do Google Workspace
					Organizacji.
				</li>
				<li>
					Serwis dziala w modelu SaaS (Software as a Service) i jest dostepny przez przegladarke
					internetowa.
				</li>
			</ol>

			<h2>3. Rejestracja i konto</h2>
			<ol>
				<li>Rejestracja wymaga podania adresu e-mail i autoryzacji przez konto Google.</li>
				<li>
					Uzytkownik odpowiada za bezpieczenstwo swojego konta i nie powinien udostepniac danych
					logowania osobom trzecim.
				</li>
				<li>
					Operator zastrzega sobie prawo do zawieszenia konta w przypadku naruszenia Regulaminu.
				</li>
			</ol>

			<h2>4. Dane i prywatnosc</h2>
			<ol>
				<li>
					Serwis przetwarza dane z Google Workspace Organizacji wylacznie w zakresie niezbednym do
					swiadczenia uslugi.
				</li>
				<li>
					Przetwarzanie danych odbywa sie zgodnie z RODO. Szczegoly okresla{" "}
					<Link to="/privacy" className="text-primary hover:underline">
						Polityka Prywatnosci
					</Link>
					.
				</li>
				<li>Dane sa szyfrowane w transmisji (TLS) oraz w spoczynku (AES-256).</li>
				<li>
					Kopie zapasowe tworzone sa zgodnie z zasada 3-2-1 (3 kopie, 2 rozne media, 1 kopia
					offsite).
				</li>
			</ol>

			<h2>5. Ograniczenia korzystania</h2>
			<p>Uzytkownik zobowiazuje sie nie:</p>
			<ol>
				<li>dokonywac inzynierii wstecznej ani probowac uzyskac kodu zrodlowego Serwisu,</li>
				<li>automatycznie scrapowac lub masowo pobierac danych z Serwisu,</li>
				<li>uzywac Serwisu do przesylania zlosliwego kodu, spamu lub tresci oszukanczych,</li>
				<li>zaklocac integralnosci lub dzialania Serwisu,</li>
				<li>udostepniac dostepu do Serwisu osobom nieupowaznionym przez Organizacje.</li>
			</ol>

			<h2>6. Wlasnosc intelektualna</h2>
			<ol>
				<li>
					Operator zachowuje wszelkie prawa do Serwisu, jego kodu, projektu graficznego i
					algorytmow.
				</li>
				<li>Dane Organizacji przetwarzane w Serwisie pozostaja wlasnoscia Organizacji.</li>
			</ol>

			<h2>7. Zastrzezenia i odpowiedzialnosc</h2>
			<ol>
				<li>Serwis dostarczany jest w stanie &ldquo;takim, w jakim jest&rdquo; (as is).</li>
				<li>
					Operator dolozy staran, aby Serwis byl dostepny 24/7, z wylaczeniem planowanych prac
					konserwacyjnych i zdarzen sily wyzszej.
				</li>
				<li>
					Operator nie ponosi odpowiedzialnosci za szkody posrednie wynikajace z korzystania z
					Serwisu.
				</li>
				<li>
					Calkowita odpowiedzialnosc Operatora ograniczona jest do kwoty oplat uiszczonych przez
					Uzytkownika w ciagu ostatnich 6 miesiecy.
				</li>
			</ol>

			<h2>8. Rozwiazanie umowy</h2>
			<ol>
				<li>
					Operator moze zawiesic lub usunac konto Uzytkownika w przypadku naruszenia Regulaminu.
				</li>
				<li>Uzytkownik moze zrezygnowac z Serwisu w dowolnym momencie, usuwajac swoje konto.</li>
				<li>
					Po usunieciu konta dane Organizacji zostana usuniete w ciagu 30 dni, chyba ze obowiazujace
					prawo wymaga dluzszego przechowywania.
				</li>
			</ol>

			<h2>9. Zmiany regulaminu</h2>
			<ol>
				<li>Operator moze aktualizowac niniejszy Regulamin w dowolnym momencie.</li>
				<li>Zaktualizowany Regulamin zostanie opublikowany w Serwisie.</li>
				<li>
					Dalsze korzystanie z Serwisu po zmianie Regulaminu oznacza akceptacje nowych warunkow.
				</li>
			</ol>

			<h2>10. Postanowienia ogolne</h2>
			<ol>
				<li>Prawem wlasciwym jest prawo polskie.</li>
				<li>Wszelkie spory rozstrzygane beda przez sad wlasciwy dla siedziby Operatora.</li>
				<li>Kontakt z Operatorem: poprzez formularz kontaktowy w Serwisie.</li>
				<li>
					Jesli ktorekolwiek postanowienie Regulaminu zostanie uznane za niewazne, pozostale
					postanowienia pozostaja w mocy.
				</li>
			</ol>
		</LegalPageLayout>
	);
}
