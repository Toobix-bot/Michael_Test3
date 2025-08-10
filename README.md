# KI Story‑Weber (GitHub Pages)

Eine leichte, clientseitige Story-Engine, die die Rollen Autor, Erzähler, Leser und Figur kombiniert – komplett im Browser, ideal für GitHub Pages.

## Start (lokal)

- Öffne `index.html` im Browser (Doppelklick genügt) oder hoste das Repo über GitHub Pages.

## Bedienung

- Idee/Prompt eingeben, Genre wählen und auf „Neue Geschichte starten“ klicken.
- Unter dem Prompt-Feld findest du Vorschlags‑Chips (z. B. Mystery: Leuchtturm‑SOS, Sci‑Fi: Zukunftssignal) zum schnellen Start.
- Modus „Geschichte“ (klassisch) oder „Meta“ (Website/Programmierer/Nutzer) wählen.
- Kapitel-Länge (Kurz/Mittel/Lang) steuert Beats pro Kapitel und Cast-Größe.
- Buttons unter „Wahlmöglichkeiten“ treffen oder eigene Eingabe über das Textfeld hinzufügen.
- Speichern/Laden nutzt `localStorage` im Browser.

### Entscheidungshilfen

Jede Wahl zeigt eine grobe Wirkungsvorschau auf die Weltwerte:

- Hoffnung, Spannung, Gefahr (in Prozent-Tendenzen)
- Risiko (niedrig/mittel/hoch) als Verdichtung der Effekte

### Mehrere Figuren & Kapitel

- Der Cast wächst mit der Kapitel-Länge (1–3 Figuren). Aktionen rotieren zwischen Figuren.
- Kapitelübergänge erzeugen kurze Zusammenfassungen; am Ende wartet ein Epilog.

## Tests

- Voraussetzung: Node.js ≥ 18
- Ausführen:

```powershell
npm test
```

## Deploy auf GitHub Pages

- Dieses Repo ist statisch. Stelle sicher, dass Pages auf den Branch mit `index.html` zeigt (z. B. `main`, Ordner „/“).

## Ideen/Erweiterungen

- Mehr Genres/Beats und feinere Effekte, z. B. Ressourcen/Inspiration.
- Export/Import als Datei (JSON) zusätzlich zu `localStorage`.
- Optional: „kreative Freiheit“-Schieber, der Zufall und Stilwechsel stärker variiert.
- Visualisierung der Weltwerte als kleine Balkenanzeige oder Sparkline.

## Meta-Fortschritt & Profile

- Läufe (Runs) erzeugen am Ende einen Score, Errungenschaften und ein Relikt.
- Ein Profil speichert: Gesamtzahl Runs/Kapitel, Bestscore, Perks (passive Start-Boni), Errungenschaften, Relikte, letzte 10 Runs.
- Perks (z. B. Optimist, CalmMind) wirken als kleine Start-Boosts auf Hoffnung/Spannung/Gefahr und sorgen für zyklische, freundliche Progression.
- Export/Import des Profils als JSON ist im „Profil & Fortschritt“-Bereich möglich.

### Heimat & Laden (Punkte)

- Abgeschlossene Runs vergeben Punkte (aus Score + Kapiteln).
- Im Abschnitt „Heimat & Laden“ kannst du Punkte gegen Perks („Optimist“, „Klarer Kopf“) oder ein Zufalls‑Relikt eintauschen.
- Gekaufte Vorteile gelten als CarryOver für künftige Runs.

