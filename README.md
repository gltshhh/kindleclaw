# kindleclaw

Backend serwujący agendę dnia jako PNG dla Kindle screensavera. Czyta `data/agenda.md`,
renderuje stronę HTML w Chromium (Puppeteer), robi screenshot i konwertuje go do
formatu wymaganego przez Kindle (grayscale, odpowiednia rozdzielczość). Klient na
Kindlu (`onlinescreensaver-k4` w siostrzanym katalogu) pobiera obraz przez HTTP.

> **System celuje w Kindle 4 NT (D01100, FW 4.1.4) konkretnie.** Backend i klient są
> projektowane jako para — backend renderuje pod 600x800 i synchronizuje się slot-aligned
> z cyklem klienta, klient (`onlinescreensaver-k4`) ma poprawki pod BusyBox 1.7.2 i sync
> zegara z `Date:` headerem. Inne modele Kindla (PW, Oasis) zadziałają z generycznym
> klientem (np. `Kuhno92/onlinescreensaverPW2`) ale stracisz część integracji.

## Geneza i pokrewne projekty

`kindleclaw` to **niezależna implementacja** zainspirowana stackiem
[`sibbl/hass-lovelace-kindle-screensaver`](https://github.com/sibbl/hass-lovelace-kindle-screensaver)
— ten sam pomysł na pipeline (Node + Puppeteer + GraphicsMagick + HTTP :5000),
ten sam punkt styku z linią „online screensaver" Petersona po stronie Kindla.

**Co jednak jest inne** (i dlaczego to nie jest fork):

| | `sibbl/hass-lovelace-kindle-screensaver` | `kindleclaw` |
|---|---|---|
| Źródło treści | Home Assistant Lovelace (zewn. UI) | Lokalny `data/agenda.md` (markdown) |
| Co Puppeteer rendruje | UI cudzej aplikacji (HA) | Własny `template.html` |
| Klient docelowy | dowolny Kindle z online screensaver | `onlinescreensaver-k4` (fork pod K4 konkretnie) |
| Forma | Hassio Add-on / docker hub image | Standalone Node app |
| Wspólny kod źródłowy | — | — (tylko wzorzec architektoniczny) |

Po stronie klienta sytuacja jest inna: **`onlinescreensaver-k4` to fork** linii
peterson → Kuhno92 → KindleOnlineScreensaver, przerobiony pod ograniczenia K4 NT
(BusyBox 1.7.2). Tam kod jest faktycznie odziedziczony i odpowiednio okredytowany
w jego własnym README.

**Czyli precyzyjnie:** backend (`kindleclaw`) = niezależna re-implementacja
w stylu sibbl, klient (`onlinescreensaver-k4`) = fork peterson/Kuhno92, system
KindleClaw jako całość = ich połączenie zaprojektowane pod K4.

## Architektura

```
┌──────────────┐    edycja      ┌──────────────────┐    HTTP GET /
│  agent / Ty  │ ─────────────→ │ data/agenda.md   │ ←──────────────── Kindle K4
└──────────────┘                └──────────────────┘                    (onlinescreensaver-k4)
                                         │
                                         ▼
                              ┌─────────────────────┐
                              │  Puppeteer (Chrome) │
                              │  → screenshot PNG   │
                              │  → GraphicsMagick   │
                              │     (grayscale, 8b) │
                              └─────────────────────┘
                                         │
                                         ▼
                                output/kindle.png  ◀── HTTP server :5000
```

1. Agent (lub Ty ręcznie) zapisuje zadania w `data/agenda.md`.
2. Endpoint `POST /push` (lub cron, lub start) odpala render: HTML → screenshot → konwersja.
3. Kindle pobiera `GET /` co N minut wg własnego harmonogramu (patrz `onlinescreensaver-k4`).

## Wymagania

- **Node.js 16+** (testowane na 22.x)
- **npm**
- **GraphicsMagick** (`gm` — nie ImageMagick!)
- **Chromium**: Puppeteer w użytej wersji (`^11.0.0`) ściąga własny binary do
  `node_modules/puppeteer/.local-chromium/` przy `npm install` (~300 MB). To celowe
  — każda wersja puppeteera jest sparowana z konkretną wersją Chrome.

> **Dlaczego `node_modules` waży ~420 MB?** Bo Puppeteer wciąga całego Chromium.
> Tak działa standardowo. Jeśli chcesz użyć systemowego Chromium, ustaw
> `PUPPETEER_SKIP_DOWNLOAD=1` przed `npm install` i wskaż binary przez
> `puppeteer.launch({ executablePath: '/usr/bin/chromium' })` w `index.js`.

## Instalacja (Linux — Debian/Ubuntu)

### 1. Zależności systemowe

```bash
sudo apt update
sudo apt install -y graphicsmagick
sudo apt install -y libnss3 libatk1.0-0 libxkbcommon0 libgbm1 libpangocairo-1.0-0 \
                    libasound2 libcups2 libatk-bridge2.0-0 libxdamage1 libxfixes3 \
                    libxcomposite1 libxrandr2 libxinerama1 libxcursor1 libxi6 libxtst6 libxss1
```

> Lista jest „defensywna" — na świeżej instalce Ubuntu zwykle brakuje 2-3 z nich
> i Puppeteer wywala konkretny `error while loading shared libraries: libXXX.so.N`.
> Doinstaluj brakujące pojedynczo, jeśli nie chcesz lecieć całą listą.

### 2. Zainstaluj aplikację

```bash
cd kindleclaw/
cp .env.example .env
npm install
```

### 3. Uruchom

```bash
node index.js
```

Powinieneś zobaczyć:

```
agenda: /ścieżka/kindleclaw/data/agenda.md
output: /ścieżka/kindleclaw/output/kindle.png
size:   600x800 (rotation=0)
Launching browser...
Initial render OK (written=true, hash=...)
Cron disabled (push-on-demand). POST /push to re-render.
Server listening on :5000
```

### 4. Smoke test

W drugim terminalu:

```bash
# Podgląd HTML — otwórz w przeglądarce
curl http://localhost:5000/preview

# Pobierz PNG
curl -fsS http://localhost:5000/ -o /tmp/kindle.png && file /tmp/kindle.png
# → PNG image data, 600 x 800, 8-bit grayscale
```

### 5. (Opcjonalnie) systemd — auto-start przy boot

```bash
sudo tee /etc/systemd/system/kindleclaw.service > /dev/null <<'EOF'
[Unit]
Description=KindleClaw agenda renderer
After=network.target

[Service]
Type=simple
WorkingDirectory=/ścieżka/do/kindleclaw
ExecStart=/usr/bin/node index.js
Restart=on-failure
RestartSec=5
User=twoja_nazwa_użytkownika

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now kindleclaw
sudo systemctl status kindleclaw
```

## Format pliku `data/agenda.md`

Serwer czyta ten plik przy każdym renderze. Format:

```markdown
# Agenda

**Data:** 2026-05-04

## Zadania

1. Opis zadania bez deadline'u
2. Zadanie z datą | 2026-05-10
3. Zadanie z datą i godziną | 2026-05-08 14:00
4. Kolejne bez deadline'u
5. ...
```

- Pole `**Data:**` jest wymagane (pokazuje się jako nagłówek dnia).
- Lista numerowana `1. 2. 3.` — co najmniej jedno zadanie.
- Serwer pokazuje maksymalnie **5 zadań**, reszta jest ignorowana.
- **Deadline (opcjonalny):** dopisz na końcu linii ` | YYYY-MM-DD` lub
  ` | YYYY-MM-DD HH:MM`. Po prawej zadania pojawi się badge z countdownem
  (`1d 5h`, `3h 20m`, `45m`, `Dziś`, `Teraz`). Po terminie badge dalej
  pokazuje liczbę (czas, który minął), ale tło inwertuje się na czarne.
  Bez deadline'u — brak badge'a, zadanie traktowane jako luźne.
- **Stopka "ostatnia aktualizacja"** jest generowana automatycznie z czasu
  ostatniego renderu — nie wpisujesz jej w `agenda.md`.

Jeśli parser zawiedzie, render produkuje obrazek z komunikatem błędu zamiast
agendy — łatwo zauważyć na ekranie Kindla.

## Co widać na ekranie

Layout PNG (od góry):

1. **Pasek bieżącej godziny** w stylu pomodoro — duża cyfra `15:` plus 3 segmenty
   reprezentujące podział godziny na bloki 20-minutowe (`0-20`, `20-40`, `40-60`).
   Segmenty już minione są **wypełnione na czarno**, segment trwający ma
   **pogrubione obramowanie** (samo kontur), przyszłe są puste. Daje to natychmiast
   poczucie "ile zostało z tej godziny" bez patrzenia na cyfrowy zegarek (który
   i tak byłby nieaktualny — ekran odświeża się co ~20 min).
2. **Data** — z pola `**Data:**` w `agenda.md`.
3. **Lista zadań** — numerowana, do 5 pozycji. Po prawej każdej pozycji może
   pojawić się badge countdownu, jeśli zadanie ma deadline.
4. **Stopka** — `ostatnia aktualizacja: YYYY-MM-DD HH:MM` (czas wygenerowania
   tego konkretnego PNG-a, nie czas edycji `agenda.md`).

### Wygląd badge'a countdown

Badge ma dwa tryby — odlicza **do** deadline'u albo **od** deadline'u
(po terminie). W obu przypadkach pokazuje konkretną liczbę, nigdy "Overdue"
ani innego napisu — tylko czas. Tło informuje o trybie:

| Stan zadania                | Treść badge'a            | Wygląd                                       |
|-----------------------------|--------------------------|----------------------------------------------|
| Brak deadline'u             | (brak badge'a)           | sama treść zadania, bez prostokąta            |
| Deadline odległy o > 24h    | `16d`, `2d`, `7d 22h`    | biały prostokąt z czarną ramką                |
| Tego samego dnia, z godziną | `3h 20m`, `45m`          | biały prostokąt z czarną ramką                |
| Bez godziny, dziś           | `Dziś`                   | biały prostokąt z czarną ramką                |
| Z godziną, < 1 min do       | `Teraz`                  | biały prostokąt z czarną ramką                |
| **Po terminie, z godziną**  | **`2h`, `1d 3h`, `45m`** | **czarny prostokąt, biały tekst (inwersja)**  |
| **Po terminie, bez godziny**| **`1d`, `4d`**           | **czarny prostokąt, biały tekst (inwersja)**  |

Po terminie badge **odlicza w drugą stronę** — pokazuje ile czasu **minęło
od deadline'u**, na czarnym tle. Czyli:

- Deadline był wczoraj o 14:00, teraz 16:00 → `1d 2h` na czarno.
- Deadline był 5 dni temu (bez godziny) → `4d` na czarno (liczone od końca
  tamtego dnia, czyli `23:59:59`).
- Deadline minął 30 minut temu → `30m` na czarno.

Z daleka czarna plama po prawej stronie listy od razu odróżnia spóźnione
zadania od białych badge'y z liczbą do zrobienia. Liczba na badge'u rośnie
wraz z każdym kolejnym renderem PNG-a (czyli co cron-tick lub `POST /push`).

## Endpointy

| Metoda       | Ścieżka     | Opis                                          |
|--------------|-------------|-----------------------------------------------|
| `GET`        | `/`         | Serwuje `output/kindle.png` (z ETag i 304)    |
| `HEAD`       | `/`         | Tylko nagłówki (Kindle używa do sprawdzenia)  |
| `GET`        | `/preview`  | Podgląd HTML w przeglądarce                   |
| `POST`/`GET` | `/push`     | Wymusza re-render (zwraca JSON z hash i flag) |

Po zmianie `data/agenda.md`:

```bash
curl -X POST http://localhost:5000/push
# → {"ok":true,"written":true,"hash":"a1b2c3..."}
```

`written: false` oznacza, że nowy render dał ten sam PNG co poprzedni (hash się
zgadza) — ETag chroni Kindla przed niepotrzebnym re-downloadem.

## Konfiguracja (`.env`)

| Zmienna                  | Default              | Opis                                                |
|--------------------------|----------------------|-----------------------------------------------------|
| `PORT`                   | `5000`               | Port serwera HTTP                                   |
| `AGENDA_PATH`            | `./data/agenda.md`   | Plik źródłowy agendy                                |
| `OUTPUT_PATH`            | `./output/kindle.png`| Plik wynikowy PNG                                   |
| `TASKS_PATH`             | (puste)              | Opcjonalny — auto-sync z `TASKS.md` (patrz niżej)   |
| `TASKS_LIMIT`            | `5`                  | Ile tasków przepisywać do agendy                    |
| `WIDTH`                  | `600`                | Szerokość w pikselach                               |
| `HEIGHT`                 | `800`                | Wysokość w pikselach                                |
| `ROTATION`               | `0`                  | Rotacja końcowego PNG (0/90/180/270)                |
| `GRAYSCALE_DEPTH`        | `8`                  | Głębia bitowa (1/2/4/8)                             |
| `COLOR_MODE`             | `GrayScale`          | `GrayScale` lub `TrueColor`                         |
| `CONTRAST`               | `1`                  | Mnożnik kontrastu                                   |
| `DITHER`                 | `false`              | Floyd-Steinberg dithering (`true`/`false`)          |
| `CRON_JOB`               | (puste)              | Wyrażenie cron do cyklicznego renderu              |
| `RENDERING_DELAY`        | `0`                  | Opóźnienie przed screenshotem (ms)                  |
| `RENDERING_TIMEOUT`      | `10000`              | Timeout renderowania HTML (ms)                      |
| `BROWSER_LAUNCH_TIMEOUT` | `30000`              | Timeout startu Chromium (ms)                        |

Jeśli `CRON_JOB` jest pusty — tryb **push-on-demand**: render raz na starcie i tylko
na żądanie. To jest preferowany tryb przy K4, gdzie Kindle sam pulluje obraz.

Przykład cyklicznego: `CRON_JOB="*/20 * * * *"` (co 20 min).

## Rozdzielczości popularnych Kindle

| Model                       | WIDTH    | HEIGHT  |
|-----------------------------|----------|---------|
| **Kindle 4 (D01100)** ← domyślny | **600**  | **800** |
| Paperwhite 2                | 758      | 1024    |
| Paperwhite 3/4/5            | 1072     | 1448    |
| Oasis                       | 1264     | 1680    |
| Scribe                      | 1860     | 2480    |

Ustaw w `.env` wartości pasujące do swojego modelu.

## Klient na Kindlu

`kindleclaw` to tylko backend — sam serwuje PNG, nic nie pcha do Kindla.
Po stronie Kindla potrzebujesz klienta, który cyklicznie pulluje `GET /` i ustawia
obraz jako screensaver. Wybór zależy od modelu:

| Kindle                       | Rekomendowany klient                                                                                                  |
|------------------------------|-----------------------------------------------------------------------------------------------------------------------|
| **Kindle 4 NT (D01100, FW 4.1.4)** | **[`onlinescreensaver-k4`](https://github.com/gltshhh/onlinescreensaver-k4)** — fork pod ograniczenia BusyBox 1.7.2 + sync zegara z `Date:` headera |
| Paperwhite 2 (i nowsze, do spróbowania) | [`Kuhno92/onlinescreensaverPW2`](https://github.com/Kuhno92/onlinescreensaverPW2) (oryginał) |

`onlinescreensaver-k4` to **fork** [`Kuhno92/onlinescreensaverPW2`](https://github.com/Kuhno92/onlinescreensaverPW2)
przerobiony pod K4 NT — usunięte konstrukcje, których BusyBox 1.7.2 nie zna
(`nohup`, `source`, `grep -E`, `pidof -x`, `wget --spider/--timeout/--tries`),
dodana retry pętla na WiFi po RTC wakeup. Dodatkowo fork zawiera **dwie nowe
funkcje synchronizacji** dopisane pod ten backend: slot-aligned wakeup
(scheduler trafia w cron tego serwera, a nie pobiera "stary" PNG przez 19 z
20 minut) oraz clock sync z `Date:` headera (zegar Kindla synchronizuje się
z zegarem serwera bez NTP). Na PW oryginał Kuhno92 dalej będzie sensowny —
fork forsuje pewne wybory K4-specyficzne, ale nowe funkcje sync są przenośne.

Po stronie klienta wystarczy ustawić `IMAGE_URI` na adres tego serwera
(`http://<IP-twojej-maszyny>:5000/`). Pełne instrukcje instalacji w README
odpowiedniego klienta.

## Opcjonalny auto-sync z `TASKS.md`

Domyślnie `agenda.md` jest źródłem prawdy — agent (lub Ty) edytuje go bezpośrednio.
Ale jeśli już prowadzisz większy plik `TASKS.md` z całym backlogiem (sekcje
`## PILNE`, `## PROJEKTY W TOKU`, taski jako `### Tytuł`), możesz włączyć
**auto-sync**: przed każdym renderem backend regeneruje `agenda.md` z `TASKS.md`,
biorąc pierwsze N zadań z sekcji "PILNE" i ewentualnie "PROJEKTY W TOKU".

To rozwiązuje problem ręcznej synchronizacji dwóch plików — nie musisz pamiętać,
żeby przepisywać zadania z master listy do agendy.

### Włączenie

W `.env`:

```bash
# Wskaż gdzie u Ciebie leży TASKS.md - dowolna ścieżka, dowolna struktura.
# Przykłady:
TASKS_PATH=/home/jakub/workspace/TASKS.md         # plik w głównym workspace
TASKS_PATH=../../TASKS.md                          # 2 poziomy wyżej
TASKS_PATH=./data/TASKS.md                         # obok agenda.md

TASKS_LIMIT=5                                      # ile tasków do agendy (domyślnie 5)
```

Po restarcie zobaczysz w logu:

```
[sync] TASKS.md -> agenda.md (5 zadań)
Initial render OK ...
```

Jeśli `TASKS_PATH` jest puste — sync wyłączony, działa po staremu (ręczna edycja
`agenda.md`). Jeśli plik nie istnieje pod wskazaną ścieżką — log warning, render
leci dalej z istniejącym `agenda.md` (failsafe, nie crashuje serwera).

### Format `TASKS.md`

```markdown
# TASKS.md — moja master lista

## 🔴 PILNE

### Moja frima — Spotkanie
- **Deadline:** 2026-05-05 12:00
- **Status:** Zaplanowane

### POLDex — Telefon
- **Akcja:** Zadzwonić w sprawie wyceny
- **Status:** Czeka na telefon

### Propozycja oferty
- **Status:** ✅ WYSŁANE 22.04   ← pominięte (status zawiera ✅ albo WYSŁANE)

## 🟡 PROJEKTY W TOKU

### Ropczyce — transport
- **Deadline:** 2026-06-01
```

Reguły parsera:

- Bierze taski z sekcji których nagłówek `## ...` zawiera słowo **`PILNE`** albo
  **`TOKU`**. Inne sekcje (np. `## DO KONTAKTU`, `## HISTORIA`) są ignorowane.
- Każdy task = nagłówek `### Tytuł`. Tytuł trafia do agendy jak jest.
- Linia `- **Deadline:** YYYY-MM-DD [HH:MM]` — wyciąga datę (i opcjonalnie
  godzinę). Inne linie typu `- **Deadline przegapiony:** 27.04` są **ignorowane**
  (data nie jest w formacie ISO, więc nie wjedzie na badge countdown).
- Linia `- **Status:** ...` zawierająca `WYSŁANE` / `Ukończone` / `✅` →
  task **pomijany** (zamknięte sprawy nie marnują slotów).
- Limit `TASKS_LIMIT` (domyślnie 5) — tyle pierwszych tasków idzie do agendy,
  reszta jest pomijana. Priorytet: PILNE → potem TOKU.

### Pole `**Data:**` w wygenerowanej agendzie

Sync wstawia bieżącą datę dnia (`YYYY-MM-DD` z czasu systemowego). Jeśli chcesz
sterować datą ręcznie — nie włączaj sync, edytuj `agenda.md` bezpośrednio.

### Co z `data/agenda.md` przy włączonym sync?

Jest **nadpisywany przy każdym renderze**. Nie edytuj go ręcznie — i tak zostanie
zastąpiony zawartością wygenerowaną z `TASKS.md`. Edytuj `TASKS.md`.

## Integracja z agentem AI (OpenClaw)

Skill OpenClaw (lub dowolny inny agent) zapisuje listę zadań do `data/agenda.md`
i wywołuje `curl -X POST http://localhost:5000/push`.

### Co agent powinien wpisywać

Plik to czysty markdown — agent generuje go w całości. Minimalna struktura:

```markdown
# Agenda

**Data:** YYYY-MM-DD

## Zadania

1. <treść zadania> [| YYYY-MM-DD [HH:MM]]
2. ...
```

**Wytyczne dla agenta:**

- **`**Data:**`** — bieżąca data dnia; agent ustawia ją sam przy każdym pełnym
  przepisie pliku.
- **Pole `**Ostatnia aktualizacja:**` — NIE dodawaj.** Stopka jest renderowana
  automatycznie z czasu ostatniego buildu PNG.
- **Maksymalnie 5 zadań** — pozostałe i tak nie zmieszczą się na ekranie K4.
  Agent powinien priorytetyzować: zadania z najbliższym deadline'em na górze.
- **Deadline** — opcjonalny separator ` | ` na końcu linii zadania, po nim
  data w formacie `YYYY-MM-DD` lub `YYYY-MM-DD HH:MM` (24h, czas lokalny PL).
  Bez deadline'u — pomiń sekcję `| ...`, zadanie pójdzie bez countdownu.
- **Treść zadania** — krótko (1 linia, ~40-60 znaków), bo czcionka jest duża
  i zadanie z długą treścią się przytnie albo zawinie kosztem badge'a.
- **Po zapisie pliku zawsze wywołaj `POST /push`** — bez tego Kindle nie
  zobaczy zmian aż do najbliższego cron-tick'a (jeśli `CRON_JOB` w ogóle ustawione).

### Przykład (agent generuje cały plik)

```markdown
# Agenda

**Data:** 2026-05-04

## Zadania

1. Acme Corp — telefon w sprawie projektu | 2026-05-04 18:00
2. Foo Sp. z o.o. — odpowiedź na maila | 2026-05-06
3. Klient X — wniosek o dofinansowanie | 2026-05-12 14:00
4. Bar Industries — zebrać materiały
5. Baz Foundation — warsztaty terenowe | 2026-05-20
```

Po renderze: zadanie 1 dostanie badge `2h 6m` (jeśli teraz jest 15:54),
zadanie 2 — `2d`, zadanie 3 — `7d 22h`, zadanie 4 — bez badge'a (brak deadline'u),
zadanie 5 — `16d`. Po terminie badge dalej pokazuje liczbę (czas od deadline'u,
np. `2h`, `1d 3h`), ale tło inwertuje się na czarne.

### Wywołanie z poziomu agenta

```bash
# 1. Agent zapisuje plik
cat > data/agenda.md <<'EOF'
# Agenda
**Data:** 2026-05-04
## Zadania
1. ...
EOF

# 2. Wymuś re-render
curl -fsS -X POST http://localhost:5000/push
# → {"ok":true,"written":true,"hash":"..."}
```

`written: false` w odpowiedzi = nowy render dał identyczny PNG (np. nic się
nie zmieniło merytorycznie i jesteśmy w tym samym 20-min bloku godziny) —
to nie błąd, ETag i tak ochroni Kindla przed re-downloadem.

## Troubleshooting

**`error while loading shared libraries: libXXX.so.N`** — brak biblioteki systemowej
dla Chromium. Doinstaluj odpowiedni pakiet (lista wyżej).

**`Error: Could not execute GraphicsMagick: gm "convert"`** — GraphicsMagick nie
zainstalowany lub poza PATH:
```bash
gm version    # sprawdź
sudo apt install -y graphicsmagick
```

**`Failed to launch the browser process`** — typowo brakujące biblioteki Chromium
(zob. wyżej). Jeśli brakuje konkretnej, log puppeteera pokaże nazwę pliku `.so`.

**Błąd parsowania `agenda.md`** — sprawdź `**Data:**` (z dwukropkiem) i listę
numerowaną. Komunikat błędu pojawi się też wprost na PNG-u.

**Kindle pokazuje stary obraz** — agent nie wywołał `POST /push` po zmianie
agendy, lub Kindle ma długi interwał w `SCHEDULE` w `bin/config.sh`.

## License

MIT — zob. plik `LICENSE`. Use at your own risk: kod uruchamia headless Chromium
i serwuje pliki przez HTTP w sieci lokalnej; w sieci publicznej dorzuć reverse
proxy + auth.

## Credits

**Inspiracja architektury:**
- **[sibbl/hass-lovelace-kindle-screensaver](https://github.com/sibbl/hass-lovelace-kindle-screensaver)**
  — od tego projektu pożyczony jest cały stack (Node + Puppeteer + GraphicsMagick + HTTP server :5000)
  i pomysł na pipeline „render w headless Chromium → grayscale PNG → polling przez Kindle".
  `kindleclaw` nie jest jego forkiem (brak wspólnej historii git, kod backendu napisany od zera),
  ale bez sibbl nie byłoby tego projektu w tej formie. Dziękuję.

**Zewnętrzne biblioteki użyte w backendzie:**
- **[Puppeteer](https://pptr.dev/)** + Chromium — render HTML do PNG.
- **[GraphicsMagick](http://www.graphicsmagick.org/)** (przez [`gm`](https://www.npmjs.com/package/gm))
  — konwersja do grayscale i resize.
- **[node-cron](https://www.npmjs.com/package/cron)**, **[dotenv](https://www.npmjs.com/package/dotenv)**,
  **[fs-extra](https://www.npmjs.com/package/fs-extra)** — drobiazgi narzędziowe.

Sam kod backendu (HTTP server, parser `agenda.md`/`TASKS.md`, layout PNG,
hour-blocks, countdown badge) jest oryginalny — nic stąd nie pochodzi z
żadnego forka.

**Klient na Kindle:** [`onlinescreensaver-k4`](https://github.com/gltshhh/onlinescreensaver-k4)
to osobne repo i osobna historia — fork [`Kuhno92/onlinescreensaverPW2`](https://github.com/Kuhno92/onlinescreensaverPW2),
który z kolei pochodzi od [oryginalnego online screensaver](https://www.mobileread.com/forums/showthread.php?t=236104)
Petersona z mobileread. Pełne dziedziczenie i credits — w README tamtego repo.
