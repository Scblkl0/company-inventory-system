# System inwentaryzacji majątku firmowego

Prosty projekt studencki: Angular + Express + SQLite. Aplikacja pozwala zarządzać majątkiem firmy, pracownikami, kategoriami i lokalizacjami oraz śledzić historię zmian.

## Uruchomienie

### Najprostszy sposób (macOS lub Linux)

1. Zainstaluj Node.js 20.19+, 22.12+ albo 24+.
2. Otwórz terminal w katalogu projektu.
3. Nadaj plikom uprawnienia, jeśli system ich nie zachował: `chmod +x install.sh start.sh`.
4. Uruchom instalator: `./install.sh`.
5. Uruchom aplikację: `./start.sh`.
6. Otwórz `http://localhost:4200`.

Zatrzymanie aplikacji: `Ctrl+C` w terminalu.

### Uruchomienie ręczne lub Windows

1. Uruchom `npm run install:all`.
2. W pierwszym terminalu uruchom `npm run dev:backend`.
3. W drugim terminalu uruchom `npm run dev:frontend`.
4. Otwórz `http://localhost:4200`.

Domyślne konto: **admin** / **admin123**.

Baza danych jest tworzona automatycznie w `backend/data/inventory.sqlite` przy pierwszym uruchomieniu.

## Główne elementy

- logowanie oparte na sesji;
- CRUD: assets, employees, categories i locations;
- automatyczne numery inwentarzowe;
- osobne wydawanie i zwracanie sprzętu pracownikom;
- automatyczne generowanie unikalnego loginu i hasła tymczasowego dla kont pracowników;
- przypisanie składnika majątku do pracownika;
- automatyczny status majątku wynikający z wydania pracownikowi;
- dashboard z prostymi statystykami;
- automatyczna historia dodawania, edycji i usuwania majątku.
- tworzenie konta razem z pracownikiem;
- role `admin` i `user` oraz kontrola uprawnień po stronie backendu;
- automatycznie wygenerowane hasło, które użytkownik może później dobrowolnie zmienić;
- zarządzanie kontami: blokowanie, zmiana roli i reset hasła;
- profil użytkownika z listą przypisanego wyposażenia.

## Role użytkowników

- `admin` zarządza majątkiem, pracownikami, słownikami i kontami użytkowników;
- `user` korzysta wyłącznie z własnego profilu, zmienia hasło i przegląda wyposażenie przypisane do siebie.

Konto można utworzyć bezpośrednio w formularzu pracownika. Login i hasło są generowane automatycznie, a użytkownik może korzystać z otrzymanego hasła lub później zmienić je w swoim profilu.
