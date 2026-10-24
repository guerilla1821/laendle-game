# Ländle Leben

Lebenssimulation im Browser auf den echten Geodaten Liechtensteins: 17'000 Gebäude mit echten Grundrissen,
Gelände aus swissALTI3D, Busse und Bahn nach Fahrplan, Beschilderung, Orte und Vereine, Live-Wetter mit Föhnindex
und Sonnen- und Mondstand über dem echten Berghorizont.

Die Daten kommen aus der Pipeline [laendle-geodata](https://github.com/guerilla1821/laendle-geodata), die sie
zweimal pro Woche (Wetter stündlich) aktualisiert und als Kacheln in einen öffentlichen Supabase-Speicher legt.
Die Adresse steht in `js/config.js`; zum Testen lässt sie sich mit `?data=<url>` überschreiben.

## Aufbau

| Datei | Inhalt |
|---|---|
| `index.html` | Oberfläche |
| `js/config.js` | Adresse der Datenkacheln |
| `js/astro.js` | Sonnen- und Mondstand, Zeitzone Vaduz |
| `js/data.js` | Kacheln, Gelände, Fahrplan, Wetter, Vereine |
| `js/game.js` | Karte, 3D-Szene, Figuren, Simulation |
| `data/` | Gebäudepunkte fürs ganze Land und Reliefkarte (Übersichtskarte) |

Statische Seite ohne Build-Schritt, veröffentlicht über GitHub Pages (`.github/workflows/pages.yml`).
Lokal: `python3 -m http.server` im Ordner starten und `http://localhost:8000` öffnen.

## Quellen

Gebäude- und Wohnungsregister (Amt für Statistik, Liechtenstein) · Amtliche Vermessung und Reliefkarte
(Amt für Tiefbau und Geoinformation, Liechtenstein) · swissALTI3D © swisstopo · © OpenStreetMap-Mitwirkende (ODbL) ·
Fahrplandaten opentransportdata.swiss · Copernicus DEM GLO-30 · Wetter Open-Meteo.com (CC BY 4.0) ·
Föhnindex MeteoSchweiz · Vereinsverzeichnisse der Gemeinden · Sonnenstand nach SunCalc (V. Agafonkin, BSD)
