# Private, expiring Nearby presence

Nearby discovery uses foreground device location only after the user opts in, stores coordinates in a private database table with a short expiry, and returns coarse distance bands instead of coordinates. This keeps distance-radius results useful across web and mobile while limiting location exposure and avoiding reuse of profile or friend-location fields.
