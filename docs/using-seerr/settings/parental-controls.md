---
title: Parental Controls
description: Hide titles above an age from some users.
sidebar_position: 8
---

# Parental Controls

Parental profiles hide every movie and series above an age from the users who have one: Discover, Trending, Search, recommendations, people, collections, the title pages and requests. A user without a profile sees everything.

## Rating Countries

Seerr reads each title's age ratings from TMDB. A title takes its age from the first country in this list that rates it; ratings from other countries are ignored. Supported countries: United States, Canada, United Kingdom, France, Germany, Spain, Italy, Netherlands, Australia and Brazil.

Each rating maps to the age its rating body sets. Ratings with no legal age use the body's own wording: for example, a US "PG" counts as 10 and a UK "PG" as 8. Adult-only ratings (such as UK "R18" or Australian "RC") and titles TMDB marks as adult are hidden from every profile.

## Parental Profiles

A profile has a name, a maximum age from 0 to 18, and whether it shows unrated titles (titles no listed country rates). Unrated titles are hidden by default.

A profile cannot be deleted while users have it.

## Assigning a Profile

Open a user's settings, General, and pick their Parental Profile. Only users with the Manage Users permission see this field, and nobody can change their own profile.

## Limits

- Filtering happens on the server, so every app using the Seerr API gets it.
- The first time a restricted user opens a page, Seerr looks up each title's ratings; later views use a 24 hour cache (Settings, Jobs & Cache, "Parental Controls Ratings").
- The sign-in page background images are not filtered.
