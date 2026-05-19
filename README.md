# Karikko

Matalikkovaroitin Suomen sisävesille ja rannikolle.

Saimaan vedenkorkeus on alimmillaan 50 vuoteen. Uusia kiviä paljastuu. Veneilijät eivät tiedä missä ne ovat. Karikko on sovellus jossa käyttäjät merkitsevät matalikkoja jaettavalle kartalle — ja näkevät reaaliaikaisesti vedenkorkeuden ja viralliset väylät.

## Ominaisuudet

- **Jaettu matalikkokartta** — merkitse matalikko GPS-pisteeseen, kaikki näkevät sen
- **Reaaliaikainen vedenkorkeus** — SYKE:n hydrologiarajapinta, lähin mittausasema
- **Viralliset väylät** — Väyläviraston navigointilinjat kartalla katkoviivana
- **Suomenkielinen kartta** — OpenFreeMap, nimet suomeksi
- **A11y ensin** — ei punavihreää väriyhdistelmää, kaikki varoitukset tekstinä värin lisäksi

## Stack

**Sovellus**
- React Native + Expo SDK 54
- TypeScript
- MapLibre React Native
- expo-sqlite (offline-varmuuskopio)
- expo-location

**Backend** ([karikko-api](https://github.com/mikko-lab/karikko-api))
- Next.js 15 App Router
- TypeScript
- Neon PostgreSQL (serverless)
- Vercel

**Integraatiot**
- [SYKE Hydrologiarajapinta](https://rajapinnat.ymparisto.fi/api/Hydrologiarajapinta/1.2/odata/) — vedenkorkeus
- [Väylävirasto OGC Features API](https://avoinapi.vaylapilvi.fi/vaylatiedot/ogc/features/v1/) — väylät ja turvalaitteet
- Tulossa: Fintraffic/Digitraffic (väylähäiriöt, AIS), FMI (sää)

## Kehitysympäristö

```bash
# Asenna riippuvuudet
npm install

# Käynnistä kehityspalvelin
npx expo start

# Android-emulaattori (vaatii Android Studion ja Pixel 9 AVD:n)
npx expo run:android
```

**Ympäristömuuttujat** — luo `.env.local`:
```
# Ei tarvita toistaiseksi — backend URL on kovakoodattu kehityksessä
```

## Tietoturva

Kaikki avoimet rajapinnat (SYKE, Väylävirasto) kutsutaan backendin kautta — ei suoraan sovelluksesta. Käyttäjästä ei tallenneta henkilötietoja.

## Lisenssi

MIT
