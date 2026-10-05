---
title: Three Azure exams change this month
subtitle: AI-500 has left beta, PL-400 becomes AB-400 on October 16, and MS-102 has eight weeks left — what to book, what to let go, and the one rename nobody needs to act on.
date: 2026-10-05
track: certifications
tags: [azure, certifications, microsoft-learn, exams]
reading: 5
---

Every Microsoft certification page was re-read on October 5, 2026 — all
sixty-three exams the Azure catalogue on this site carries, each against its
own page on Microsoft Learn, the credential-retirement page, and the Skills Hub
blog. Most of them are exactly where they were in September. Three are not, and
one is about to be renamed under you without changing anything you hold.

This post is the short version of that read, in the order it matters.

## 1. AI-500 is out of beta

Exam AI-500, *Designing and Implementing Multi-Agent AI Solutions*, entered
beta in July. On October 5 its exam page title reads "Exam AI-500: Designing
and Implementing Multi-Agent AI Solutions" with no "(beta)" after it, the
credential page is "Microsoft Certified: Multi-Agent AI Solutions Expert" with
no "(beta)" either, the Schedule exam section is there, and the retirement date
field says "none". Microsoft's June roundup said "Beta in July 2026. Generally
available in September 2026." It did not publish a day, and neither do we.

What that means for you:

- **Scores now come back on the normal schedule.** Beta candidates waited for
  the rescoring window; a GA exam is scored as you leave.
- **The practice assessment is still coming.** Microsoft's own page says
  practice assessments "are usually available within 8 weeks of the exam being
  out of beta", so plan without one for now.
- **It is an Expert exam.** The prerequisites page expects production
  experience with agentic systems, Python, and Azure compute, network, storage
  and data services. It is not a first certification.

Compare AB-650, *Administering Microsoft 365 and AI Services*, whose page still
says "(beta)" on October 5. Microsoft said it would be "Generally available in
October 2026". If you are booking AB-650 this month, check the title the day you
book: a beta booking and a GA booking are scored differently.

## 2. PL-400 becomes AB-400 on October 16

This is a renumbering, not a retirement, and the dates are tight enough to get
wrong. The PL-400 exam page says, verbatim:

> PL-400 is transitioning to AB-400 to align the exam within Microsoft's
> certification portfolio.
>
> October 16, 2026: Registration for PL-400 closes, and registration opens
> exclusively for AB-400.
>
> Learners who register for PL-400 on or before October 16 can continue to
> schedule and take the exam through October 30, 2026.

And the announcement post of September 15: "While the exam number is changing,
the certification earned remains unchanged." You earn, and keep, Microsoft
Certified: Power Platform Developer Associate either way.

So the decision tree is short:

| You are… | Do this |
| --- | --- |
| Already registered for PL-400 | Sit it by **October 30**. Nothing else changes. |
| Not yet registered, planning to take it in October | Register for PL-400 **by October 16** and sit by October 30, or wait and take AB-400. |
| Planning for November or later | It is AB-400, full stop. Registration is already open. |

The new exam is titled *Extending Microsoft Power Platform Solutions with Code
and AI*. Its study guide is already published and its "Skills measured" section
is what the PL-400 guide shows today — Microsoft updated both pages to the
October 16 objectives at the same time. The headline changes in that guide: two
new skill groups on Power Apps **code apps** (building, deploying and managing
them), a new group on building **Microsoft Foundry agents by code** that
integrate with Power Platform, and "Configure Power Automate cloud flows" widened
to include Copilot Studio workflows. The removed groups are the canvas-app
improvement and troubleshooting ones. If you prepared against the old PL-400
guide more than a month ago, re-read the new one before you book anything.

## 3. MS-102 retires November 30

Microsoft 365 Certified: Administrator Expert, and its exam MS-102, retire on
November 30, 2026 "at 11:59 PM Central Standard Time". After that date the
certification can neither be earned nor renewed. If you hold it, it stays valid
on its normal renewal clock until that clock runs out; if you are halfway to it,
you have eight weeks.

Microsoft's recommended replacement is AB-650, the Microsoft 365 and AI
Services Administrator Associate above. Note the level: Expert is replaced by
an Associate. If the Expert tier mattered to your plan, there is no like-for-like
successor on the Microsoft 365 side today.

## The rename you do not need to act on

DP-420, the Azure Cosmos DB exam, has this note on its page:

> We're updating the certification's name and level to reflect the evolving
> role of Azure Cosmos DB developers. The updated certification will be
> Microsoft Certified: Azure Cosmos DB AI Developer Associate. This change will
> go into effect on October 6, 2026. No action is required.

The exam is updated the same day. Holders keep the credential under the new
name; candidates sit the updated exam from October 6. It is worth knowing only
so that a badge that says "AI Developer Associate" next week does not read as a
different certification from the "Developer Specialty" you studied for.

## What is retired, and what replaced it

Since the summer, with the successor Microsoft recommends:

| Retired | Last day | Microsoft's recommended successor |
| --- | --- | --- |
| AZ-204 Developing Solutions for Microsoft Azure | July 31, 2026 | AI-200 Azure AI Cloud Developer Associate |
| AZ-500 Azure Security Engineer Associate | August 31, 2026 | SC-500 Cloud and AI Security Engineer Associate |
| PL-200 Power Platform Functional Consultant | August 31, 2026 | AB-410 Intelligent Applications Builder Associate |
| MB-280 Dynamics 365 Customer Experience Analyst | July 31, 2026 | AB-210 Dynamics 365 Sales AI Consultant Associate |
| AZ-800 and AZ-801 Windows Server Hybrid Administrator | September 30, 2026 | AZ-802, a single exam for the same credential |

The pattern is not subtle: the AB-series and the "AI" suffixes are where
Microsoft is moving the portfolio. A retired exam's successor is almost never a
renumbering of the same content.

## Coming, without dates yet

Two things Microsoft has announced by month only, so we store neither as a
date:

- **MB-330** (Dynamics 365 Supply Chain Management Functional Consultant)
  retirement "Expected in December 2026", succeeded by AB-330, whose beta is
  "expected in November 2026". There is no AB-330 page yet.
- **AB-650** general availability "in October 2026", as above.

When either gets a day, the catalogue gets the date and this site's status
labels change on that day without anyone editing a page — statuses are derived
from the dates at render time, which is also why a label here never says
"Expiring" for an exam that retired last week.

## How to read the catalogue page

On the Azure learning page every exam card carries a status computed from its
dates: Active, Beta, Coming (with the day it becomes available), Expiring (with
the last day) or Retired. The line under the heading says the day the whole
catalogue was last checked against Microsoft Learn — today it says October 5,
2026. If that date is more than a month old, treat the statuses as a starting
point and read the exam page before you pay for a seat.
