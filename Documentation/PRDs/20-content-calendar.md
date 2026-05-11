# PRD — Content Calendar Generator

## Feature Name
Content Calendar Generator

## Overview
Generates a monthly content calendar (4–8 long-form videos + supporting Shorts) tied to the channel's niche, recent performance, and seasonal CPM windows. Each calendar entry includes idea text, hook angle, and suggested publish date. Lifted from `claude-youtube`'s `calendar` subskill.

**Problem solved:** Creators plan one video at a time, react to dry spells, and miss seasonal opportunities. A calendar imposes cadence discipline and surfaces ideas before the user runs out of momentum.

## User Stories
- As a creator, I want a month of video ideas planned in advance, so I always have a next idea ready.
- As a creator, I want suggested publish dates aligned with my upload cadence and seasonal CPM, so I'm not posting on dead days.
- As a creator, I want each calendar entry to be one click away from running through the kit pipeline, so the calendar isn't a dead artifact.
- As a creator, I want to skip ideas I don't want and have them replaced, so the calendar fits my actual interests.

## Functional Requirements
- Input: active channel context, niche, recent video performance, target uploads/week
- Output:
  - 4–8 long-form video ideas with: idea text, hook angle, predicted score range (low/mid/high), suggested publish date
  - 8–16 Shorts ideas with idea text + suggested publish dates (Shorts cadence ~2× long-form)
  - Theme of the month: cohesive narrative or content arc binding the calendar
  - Seasonal/CPM notes: which dates are high-CPM and which are low (based on niche + general advertiser windows)
- Persist to `content_calendars` table with monthly granularity
- "Send to pipeline" action on each entry → opens `/runs/new` pre-filled with that idea
- Skip + replace: removes an idea, generates a substitute that fits the theme

## User Interface

### Screens
- **`/calendar`**: month view with a row of long-form ideas + a row of Shorts
- **`/calendar/[monthId]`**: detailed view of a specific month
- New month CTA: "Generate next month"

### Layout
- Month grid showing publish dates with idea cards on each
- Theme banner at the top
- CPM heat indicators on dates (small dots)
- Per-idea actions: Send to pipeline, Skip, Edit

### Key interactions
- Drag-and-drop to reschedule an idea (snap to upload-cadence grid)
- "Send to pipeline" routes to `/runs/new` with idea text prefilled
- Skip prompts for replacement generation

## States to Handle

### Happy path
User generates calendar → month populates → user reviews and sends ideas to pipeline as needed.

### Error states
- Insufficient channel data to predict cadence → use default 1×/week long-form
- LLM upstream error → retry; if persistent, surface partial calendar
- Date conflicts with user-set holidays/breaks → mark as gap; user can reschedule

### Empty states
- No calendar yet → CTA "Generate this month's plan"
- Empty future months until generated

### Loading states
- Card-by-card streaming as ideas are generated; full calendar typically 30–90s

## Edge Cases
- Channel uploads on irregular cadence → calendar shows looser date suggestions ("week of Jun 10")
- Niche has no clear seasonal CPM patterns → omit CPM notes
- User wants to lock specific dates for sponsored content → reservation system v2
- Calendar generated for a month already partially filled → merge new ideas into empty slots, don't overwrite
- User has multi-channel setup → each channel has its own calendar

## Out of Scope
- Auto-sending to pipeline without user confirmation
- Cross-platform calendars (TikTok, Instagram)
- Calendar export to Google Calendar / iCal (Phase 3)
- Team collaboration (shared calendar editing)
- Sponsorship slot reservation
- Mobile-optimized calendar editor
