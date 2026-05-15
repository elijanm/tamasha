#!/usr/bin/env bash

# Sample music library generator
# Creates artist/year/album structures plus miscellaneous folders

BASE_DIR="sample_music_library"

mkdir -p "$BASE_DIR"

# Artist -> Year -> Album
mkdir -p "$BASE_DIR/Daft Punk/2013/Random Access Memories"
touch "$BASE_DIR/Daft Punk/2013/Random Access Memories/01 Give Life Back to Music.mp3"
touch "$BASE_DIR/Daft Punk/2013/Random Access Memories/02 Instant Crush.flac"
touch "$BASE_DIR/Daft Punk/2013/Random Access Memories/cover.jpg"
touch "$BASE_DIR/Daft Punk/2013/Random Access Memories/credits.pdf"

mkdir -p "$BASE_DIR/Kendrick Lamar/2015/To Pimp A Butterfly"
touch "$BASE_DIR/Kendrick Lamar/2015/To Pimp A Butterfly/01 Wesley's Theory.mp3"
touch "$BASE_DIR/Kendrick Lamar/2015/To Pimp A Butterfly/02 King Kunta.flac"
touch "$BASE_DIR/Kendrick Lamar/2015/To Pimp A Butterfly/booklet.pdf"

# Singles
mkdir -p "$BASE_DIR/Adele/Singles"
touch "$BASE_DIR/Adele/Singles/Hello.mp3"
touch "$BASE_DIR/Adele/Singles/Easy On Me.flac"

# Misc / unknown artist folders
mkdir -p "$BASE_DIR/Tamasha/General/Others"
touch "$BASE_DIR/Tamasha/General/Others/Unknown Track.mp3"
touch "$BASE_DIR/Tamasha/General/Others/random_notes.txt"

# Various artists
mkdir -p "$BASE_DIR/Various Artists/2024/EDM Hits"
touch "$BASE_DIR/Various Artists/2024/EDM Hits/01 DJ Alpha - Night Drive.mp3"
touch "$BASE_DIR/Various Artists/2024/EDM Hits/02 Neon Pulse - Skywave.flac"
touch "$BASE_DIR/Various Artists/2024/EDM Hits/poster.png"

# Artist documents
mkdir -p "$BASE_DIR/Radiohead/Documents"
touch "$BASE_DIR/Radiohead/Documents/bio.docx"
touch "$BASE_DIR/Radiohead/Documents/discography.csv"
touch "$BASE_DIR/Radiohead/Documents/interview_notes.md"

# Nested compilations
mkdir -p "$BASE_DIR/Hans Zimmer/2020/Film Scores/Live"
touch "$BASE_DIR/Hans Zimmer/2020/Film Scores/Live/01 Opening.wav"
touch "$BASE_DIR/Hans Zimmer/2020/Film Scores/Live/setlist.txt"

# Archive examples
mkdir -p "$BASE_DIR/Nirvana/1991/Nevermind"
touch "$BASE_DIR/Nirvana/1991/Nevermind/demo_tapes.zip"
touch "$BASE_DIR/Nirvana/1991/Nevermind/Smells Like Teen Spirit.mp3"


echo "Sample library created in: $BASE_DIR"
echo
echo "Folder structure:"
find "$BASE_DIR" -type f | sort
