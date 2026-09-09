# E-Telly Web — System Guide & Panel Q&A

> **System:** E-Telly — *"A Smart Progressive Web and Mobile Application for Disaster
> Preparedness and Communication System Using Decentralized Network"*
> **This file covers:** the **web dashboard** (`etelly-mern`) used by CDRRMO, Barangay
> Officials, and the System Admin. For the resident-facing mobile app, see
> `etelly-mobile/MOBILE_SYSTEM_GUIDE_QA.md`.
> **Format:** one section per module. Each section has (1) a plain-language + technical
> "how it works" explanation, and (2) 2–3 real panel-style scenario questions with
> **Taglish answers** you can say out loud in a defense — grounded in the actual code, not
> textbook theory.

Sources consolidated into this file: `USER_GUIDE.md` (staff-facing usage), `PANEL_DEFENSE_QA.md`
(module Q&A), `AI_HAZARD_PREDICTION.md`, `SMS_FALLBACK_PLAN.md`, and the current
`client/src/config/roleModules.js` / `server/routes/*.js` for accuracy as of today.

---

## 0. System Overview — Roles & the "decentralized" architecture

**How it works:** E-Telly Web has three staff roles, each seeing only the modules and
data their role allows:

| Role | Scope | Modules |
|---|---|---|
| **System Admin** | Web-platform administration only — **zero** disaster-ops access | User Management, Chat Monitoring, Audit Logs, AI Model Performance |
| **CDRRMO** | Full city-wide disaster operations, all 17 barangays | Dashboard, Alerts, Reports, Hazard Map, Evacuation Centers, Safety Tips |
| **Barangay Official** | Disaster operations scoped to their **own assigned barangay only** | Same 6 modules as CDRRMO, filtered to their barangay |

Residents never log into the web app — they use the mobile app only.

The system is called "decentralized" because it doesn't need one always-on internet
connection to function during a disaster:

1. **Barangay Hall "Local Mode."** A laptop at the barangay hall runs a local Node.js/
   Express server + local MongoDB (`etelly_local`) and also serves as the WiFi access
   point (`ETelly-<barangay>`). Residents connect to that WiFi and can submit reports
   straight to the barangay official's dashboard with **no internet required** — only
   electricity for the router/laptop.
2. **Automatic sync on reconnect.** Once the laptop detects internet again, a scheduler
   (`syncToCloud.js`) pushes everything to the shared CDRRMO cloud database — checking
   every 30 seconds for reconnection, plus a catch-all sync every 5 minutes while online,
   so nothing is left behind. No manual export/click needed.
3. **Client-side offline caching.** If a resident's own connection drops (not the
   barangay hall's), the last-fetched hazard data/alerts stay cached (IndexedDB) and any
   report/alert they submit while offline is queued and auto-sent once connectivity
   returns.

The amber **"Local Mode Active"** banner on the dashboard tells staff they're running
locally and will auto-sync once internet returns.

### Panel Q&A

**Q: "Paano SMART kung wala namang internet? Paano nyo matatawag na SMART ang system nyo
kung ganon?"**
> "Internet outages talaga ang inaasahan namin, sir/ma'am — hindi exception, design
> assumption namin siya mismo, dahil disaster ang use case. So merong tatlong layers para
> hindi tumigil ang operations: una, ang barangay hall laptop na parehong server at WiFi
> access point — kaya kahit walang internet, gumagana pa rin ang core loop na
> 'resident nagre-report → nakikita agad ng official.' Pangalawa, automatic na sync sa
> CDRRMO cloud sa loob ng ilang minuto pagbalik ng internet, walang kailangang i-click
> pa ng staff. Pangatlo, may client-side offline caching sa device ng resident mismo.
> Kaya ang 'smart' hindi lang tumutukoy sa AI model namin — kasama rin dito ang design
> decision na alam ng system na puwedeng mawalan ng internet sa gitna ng disaster, at
> meron siyang planong tumakbo pa rin, imbes na basta mag-freeze."
>
> **Kung tanungin ng follow-up 'paano kung wala talagang WiFi kahit sa barangay hall?'**
> — dito papasok ang proposed SMS fallback namin: isang spare Android phone na may
> prepaid SIM, naka-connect sa parehong barangay WiFi, tumatakbo bilang local SMS
> gateway. Puwedeng magtext ang resident gamit ang sariling salita, tapos irerelay ito
> ng gateway phone papuntang local server sa loob mismo ng LAN, walang kailangang cloud
> SMS API. **Status: designed at documented na (`SMS_FALLBACK_PLAN.md`), hindi pa
> naka-deploy** — honest disclosure kung tatanungin kung gumagana na ito ngayon.

**Q: "Bakit laptop pa kailangan sa barangay hall? Di ba kaya lang naman gawin sa cloud
lahat?"**
> "Kung purely cloud-dependent ang system, sa sandaling maputol ang internet ng buong
> lugar — na madalas mangyari sa bagyo o lindol — walang paraan ang mga residente na
> mag-report o makatanggap ng alert. Ang laptop sa barangay hall ang nagpapanatiling
> gumagana ang core loop nang lokal, ipinapakita ng 'Local Mode Active' banner, at
> automatic na susync 'yan sa CDRRMO once bumalik ang internet."

**Q: "Paano kung dalawang barangay hall ang parehong naka-Local Mode — di ba magkaiba
ang datos nila?"**
> "Tama po, at sinasadya iyon — bawat barangay hall ay independent local instance, kaya
> kung maputol ang internet ng isang barangay, hindi nakadepende dito ang kapitbahay
> niyang barangay. Sa sandaling bumalik ang internet sa alinman sa mga hall, doon lang
> mag-sync ang bagong datos niya papuntang shared CDRRMO cloud database — walang
> conflict, dahil naka-tag ang bawat report kung saan siya galing."

---

## 1. Dashboard

*(CDRRMO and Barangay Official)*

**How it works:** A quick-glance overview of current disaster-response activity — active
alerts, recent reports, and other at-a-glance summaries scoped to the logged-in role
(city-wide for CDRRMO, one barangay for a Barangay Official). It's the landing page both
ops roles hit immediately after login (`ROLE_HOME`), so it's meant to answer "what's
happening right now" before drilling into a specific module.

### Panel Q&A

**Q: "Bakit kailangan ng dashboard, di ba kita naman lahat sa individual pages?"**
> "Ang bawat individual page — Alerts, Reports, at iba pa — ginawa para sa pag-aksyon sa
> isang bagay nang sabay-sabay; ang Dashboard naman ay para sa situational awareness.
> Halimbawa, isang barangay official na papasok habang may aktibong bagyo — kailangan
> niya isang tingin lang para malaman kung ilan ang aktibong alert, ilan ang pending na
> reports, hindi na kailangang mag-click-click pa sa limang page."

---

## 2. Alerts Module

*(CDRRMO and Barangay Official)*

**How it works:** This is where official hazard alerts are issued and managed. A staff
member picks a hazard type and severity (**watch → warning → critical → evacuate**) and
submits — the alert immediately appears on the map and alert feed, triggers a push
notification to residents' phones and subscribed staff browsers, and creates a matching
entry in the Reports feed for tracking. Alerts can be **Dismissed** (deactivated but kept
for history — nothing is permanently deleted) or **Resolved** (hazard has passed), and a
dismissed alert can be reactivated later. Alerts can also be auto-suggested by the AI
Hazard Prediction module (see §5) but are always flagged as unconfirmed and visually
distinct until a human confirms them.

### Panel Q&A

**Q: "May AI daw kayo — pero paano kung mali ang AI prediction, may masasaktan ba dahil
dito?"**
> "Halimbawa: mataas ang predicted flood risk ng AI model para sa isang barangay
> kinabukasan. Hindi agad ito nagiging emergency evacuation alert. Una, kinukumpara muna
> namin ito sa existing rule-based alert — kung meron nang rule-based (PAGASA rainfall
> threshold + soil moisture) na parehas o mas mataas ang severity, hindi na gagawa ang AI
> ng duplicate. Pangalawa, ang AI-generated alert ay laging naka-mark na `source: ai`,
> may dashed border sa map (di solid line, kagaya ng confirmed rule-based alerts), plus
> 'not yet confirmed' label at confidence % — kaya visually iba talaga ang treatment.
> Pangatlo, default na naka-OFF ang AI Predictions layer sa map — opt-in lang habang
> binubuild pa namin ang confidence sa model. So kung mali man ang prediction, ang worst
> case ay isang soft, non-urgent na push notification, hindi isang mandatory evacuation."

**Q: "Sino magdedecide kung 'critical' na ba dapat itawag ang alert?"**
> "Ang CDRRMO o barangay official mismo ang pumipili ng severity level — hindi
> automated ang buong desisyon. Sa sandaling isubmit nila ito, awtomatiko na itong
> lalabas sa map, sa alert feed, at magpapadala ng push notification sa mga residente at
> sa ibang staff."

**Q: "Ano ang mangyayari kapag nag-dismiss ka ng alert kung mali pala ito?"**
> "Ang pag-dismiss ay nagde-deactivate lang, pero naka-keep pa rin ang record para sa
> history — walang tinatanggal nang permanente, at puwede pang i-reactivate kung
> kinailangan pala talaga. Importante ito para sa audit trail kapag may post-incident
> review."

---

## 3. Reports Module (Citizen Emergency Reports)

*(CDRRMO and Barangay Official — "Report Monitoring")*

**How it works:** Emergency reports submitted by residents (via the mobile app, or
offline through a barangay's local server) flow through a review pipeline:

```
Resident submits report → Pending
        │
        ▼
Staff reviews (photo, hazard type, severity, description, location)
        │
        ├── Approve → publishes it, may create a matching alert
        ├── Reject  → dismissed, no alert, no effect on other residents
        │
        ▼
Approved reports are later marked Resolved once the hazard has passed
```

Nothing auto-approves. A Barangay Official only sees reports whose **submitting
resident's registered barangay** (`reporterBarangayKey`, resolved from the resident's
profile — *not* their GPS location at the moment of the report) matches their assigned
barangay; CDRRMO sees every barangay. This distinction matters: a resident's GPS location
during an incident (e.g. reporting a fire while traveling) does **not** leak the report
to a different barangay's official and does not exclude it from their own official's
view either — visibility follows the resident's home barangay, not where the emergency
physically happened. Reports can be exported for record-keeping.

### Panel Q&A

**Q: "May nagreport na fake emergency — paano nyo mahuhuli?"**
> "Walang automatic na 'approve' — laging dumadaan muna sa Pending status ang bagong
> report bago ito makita ng publiko bilang official alert. Titingnan ng staff ang photo,
> hazard type, severity, description, at exact location ng report bago piliin ang
> Approve, Reject, o direktang Resolve. Kung obvious na fake o duplicate, Reject — hindi
> ito naglalabas ng alert at wala itong epekto sa ibang residente. Approved lang ang
> puwedeng lumikha ng matching alert."

**Q: "Ano ang nakikita ng barangay official — lahat ba ng reports sa buong Antipolo?"**
> "Hindi po — scoped siya sa kanyang assigned barangay lang, at specifically sa
> registered barangay ng reporting resident, hindi sa GPS location ng insidente. Filter
> ito sa backend mismo (`reporterBarangayKey`), hindi lang UI-level — kaya kung ang
> report ay resolved sa ibang barangay, hindi ito lalabas sa dashboard ng officialng
> hindi kaugnay. Ang CDRRMO lang ang nakakakita ng lahat, dahil city-wide talaga ang
> saklaw nila."

**Q: "Paano kung ang resident ay hindi naka-account, o walang naka-match na barangay sa
kanya — makikita pa rin ba ito ng barangay official?"**
> "Honest gap ito talaga — kung walang matching registered user para sa report
> (anonymous o unregistered submitter, o lumang report bago pa ito ipatupad), `null` ang
> `reporterBarangayKey` — nagiging invisible ito sa lahat ng Barangay Official, CDRRMO
> lang ang makakakita. Pati yung mga historical-import na reports ay nasa ganitong
> sitwasyon, dahil wala nang identifying field na puwedeng pagbatayan para i-backfill."

---

## 4. Hazard Map Module

*(CDRRMO and Barangay Official)*

**How it works:** A live map of Antipolo with a layer control panel to toggle overlays:
🌊 Flood (rainfall/river forecast + hazard zones), 🌀 Typhoon (active storm tracks/
forecast paths), 🌍 Earthquake (recent seismic activity), ⛰️ Landslide (risk forecast),
📍 Reports (approved resident reports plotted at their location). This is the **same
underlying hazard data** that powers both the Alerts module and the mobile app's
hazard-aware evacuation routing — one source of truth, so staff and residents never see
conflicting hazard pictures. Barangay boundaries are approximated as a single GPS
centroid point per barangay (point-radius), not an official polygon shapefile, since no
such shapefile was available.

### Panel Q&A

**Q: "Bakit hazard map pa kailangan kung may alerts na naman kayo?"**
> "Ang alert ay 'ito na ang nangyayari, kumilos na' — ang map ay 'ito ang buong context
> bago ka gumawa ng desisyon.' Halimbawa, bago mag-issue ng flood alert, tinitingnan
> muna ng CDRRMO ang layer control panel: rainfall/river forecast overlay, typhoon
> track kung meron, recent earthquake activity, at kung may na-approve na citizen
> reports doon mismo sa lokasyon. Ang alert ang desisyon, ang map ang batayan."

**Q: "'Point-radius' lang ang barangay boundaries nyo — hindi ba mali yun?"**
> "Tama po, walang existing official barangay polygon (boundary shapefile) na available
> sa amin, kaya centroid — isang GPS point per barangay — ang ginamit namin bilang
> approximation. Isang stated, documented limitation ito, hindi bug. Ang epekto:
> puwedeng may edge-case na resident na malapit sa boundary ng dalawang barangay na
> mali ang na-assign na barangay sa kanyang report. Kung lalakihin pa ang system, ang
> susunod na hakbang ay kumuha ng totoong polygon data mula sa LGU o NAMRIA."

---

## 5. AI Hazard Prediction (part of Alerts; standalone review under §9 AI Model
   Performance)

**How it works:** A small hazard-risk prediction model (L2-regularized logistic
regression, `server/services/predictionEngine.js`) learns from accumulated resident
reports and weather data to flag elevated flood/landslide risk per barangay *before* a
rule-based threshold would fire. It was deliberately kept simple rather than using a
neural network or random forest, because the realistic training set size for one city's
capstone deployment (tens to low hundreds of labeled barangay-days) would cause a more
complex model to overfit. Being logistic regression also keeps it auditable — the exact
feature (e.g. 6-hour rainfall, soil moisture, distance to a landslide-prone barangay)
driving a prediction can be shown, which matters for a disaster-alerting feature where a
"black box" reason isn't acceptable. AI-flagged risk never bypasses human judgment — see
§2 Alerts for how it's gated, visually distinguished, and off by default.

### Panel Q&A

**Q: "Bakit logistic regression lang, hindi mas advanced na model gaya ng neural
network?"**
> "Sadyang pinili namin ang mas simpleng model dahil sa laki ng datos namin — tens to
> low hundreds ng labeled barangay-days lang ang realistic para sa isang city, isang
> capstone deployment. Kung gagamit kami ng random forest o deep neural network sa laki
> ng datos na ganito, malaki ang tsansang mag-overfit — parang cramming para lang sa
> laging parehong exam, hindi talaga natututo ng totoong pattern. Ang L2-regularized
> logistic regression ay tama ang complexity para sa dataset size namin, at bonus pa:
> fully auditable — puwede naming ipakita kung anong specific feature ang nag-drive sa
> isang prediction. Importante ito para sa isang disaster-alerting feature — hindi namin
> gustong 'black box' lang ang dahilan kung bakit may nire-recommend na alert."

**Q: "May sapat na ba kayong datos para sabihing gumagana ang AI nyo?"**
> "Real scenario: sa una, cold-start problem talaga ito — kakainstall pa lang ng
> snapshot pipeline, walang training data. Ang sinagot namin dito ay hindi maghintay ng
> buwan-buwan sa live data lang — ginamit namin ang existing historical dataset ng
> Antipolo City (`Capstone_Antipolo-Dataset.xlsx`, 2020–2025, 399 rows ng situational
> reports) para i-backfill ang training set kaagad. Pagkatapos ng import at backfill,
> nakapag-train na kami ng bersyon 1 ng model para sa flood at landslide, at may AUC na
> 0.91 (flood) at 0.94 (landslide) sa offline cross-validation — malayo sa random
> guessing (0.5). Pero honest din kami: sa 0.5 default threshold, halos zero ang
> naka-flag dahil bihira lang talaga ang positive cases (0.5% ng barangay-days) — kaya
> may `findOptimalThreshold()` kami na humahanap ng tamang cutoff base sa totoong data,
> imbes na basta 0.5. At hindi rin siya nagpapalit ng human judgment — laging naka-gate
> ang AI alert laban sa existing rule-based alert, at naka-off by default ang layer
> hangga't hindi pa napapatunayan ang reliability niya sa totoong field outcomes."

---

## 6. Evacuation Centers Module

*(CDRRMO and Barangay Official)*

**How it works:** Manages ~75 evacuation centers across Antipolo's 17 barangays. A staff
member selects a barangay (a Barangay Official only sees their own), opens a center to
edit its facility details or update its live occupancy count as evacuees arrive/leave,
and can reset a center's occupancy to 0 once an evacuation ends. Every occupancy change
is logged for audit, and updates are **immediately reflected on residents' mobile apps**
as Available / Almost Full / Full status — the same data mobile hazard-aware routing
(mobile guide §6) uses to refuse routing someone to a full center.

### Panel Q&A

**Q: "Paano malalaman ng resident kung puno na ang evacuation center bago pa siya
pumunta?"**
> "Real-time ang occupancy tracking — sa sandaling i-update ng barangay official ang
> bilang ng evacuees sa isang center, agad itong nare-reflect sa mobile app ng residente
> bilang 'Available,' 'Almost Full,' o 'Full' status. So kung isang pamilya ang
> nakikita na 'Full' na ang pinakamalapit na center bago pa sila umalis ng bahay,
> puwede na silang pumili ng ibang center sa halip na matagpuang puno pagdating nila.
> Lahat ng occupancy change ay naka-log din para sa audit — kung mag-dispute man kung
> sino ang nag-update, may record."

---

## 7. Safety Tips Module

*(CDRRMO and Barangay Official)*

**How it works:** Staff maintain the content of offline-readable safety guides (first
aid, earthquake, flood, etc.) shown in the mobile app. Once a resident's device has
downloaded the content, it's cached and readable without a live connection — the exact
moment a resident needs a safety tip is usually the moment their connection is worst.

### Panel Q&A

**Q: "Bakit kailangan pa 'offline-readable' ang safety tips, di ba app naman ito?"**
> "Kasi mismo sa oras na kailangan mo ang first-aid o earthquake safety tip — habang
> nangyayari ang disaster — ay ang oras na kadalasang wala kang matatag na internet
> connection. Kaya ang content ng Safety Tips ay naka-cache sa device ng resident,
> hindi kinakailangang mag-fetch ulit sa server bawat pagbukas. CDRRMO/Barangay official
> ang nag-maintain ng content mula sa dashboard, pero once na-download na ito ng
> resident, gumagana ito kahit walang signal."

---

## 8. User Management Module (System Admin)

**How it works:** The System Admin is the only role that can create, edit, or remove
staff accounts — there is no self-registration for CDRRMO or Barangay Official. Creating
a user requires first/last name, email, and a role. If the role is **Barangay Official**,
an **assigned barangay is required** and the form won't submit without it — this single
field is what drives all of that account's later data scoping (§3, §4, §6, §9). A strong
16-character password is auto-generated; the new staff member must set their own password
on first login. Existing users can be searched/filtered by name, email, or role, have
their password reset (new temporary password), or be edited/deleted.

### Panel Q&A

**Q: "Sino gumagawa ng account ng bagong CDRRMO staff? Puwede bang mag-sign up lang
sila mismo?"**
> "Hindi — walang self-registration para sa CDRRMO o Barangay Official. Ang System
> Admin lang ang may access dito, dahil sensitibo ang role na ito — direktang naka-attach
> ito sa disaster-response authority. Halimbawa: kapag gumawa ng Barangay Official
> account, required talagang piliin ang assigned barangay bago pa man makapag-submit ang
> form — kung hindi, hindi ito tatanggapin. Ito ang nagseset kung anong reports at
> evacuation centers makikita ng officialng ito. Bawat bagong account ay may
> auto-generated 16-character password, kaya hindi kailangang mag-imbento ng password
> ang System Admin, at required agad ang first-login password reset."

**Q: "Bakit hiwalay ang System Admin role sa CDRRMO — di ba mas simple kung parehas
lang?"**
> "Sinasadya iyan — dating iisang overloaded na `admin` role ang gumagawa ng platform
> administration at buong disaster-ops, na naghahalo ng dalawang magkaibang concern at
> level ng risk. Na-split na ito ngayon: ang System Admin ay zero disaster-ops access —
> hindi puwedeng mag-issue ng alert, hindi puwedeng gumalaw ng reports — platform-level
> lang talaga ang hawak niya: accounts, chat moderation oversight, audit logs, at AI
> model monitoring. Ang CDRRMO ang may hawak ng aktwal na disaster-response authority."

---

## 9. Chat Monitoring Module (System Admin, CDRRMO, Barangay Official)

**How it works:** This is a **resident-report-driven moderation queue**, not an automatic
content-scanning filter — a resident flags an abusive/inappropriate chat message, and it
becomes a case in the moderation queue (`ChatModerationCase`), scoped by the *reported
user's* registered barangay for Barangay Official visibility (system admin and CDRRMO see
across barangays per their role). A reviewer can:

- **Send Warning** — confirms the violation and applies an escalation ladder tied to the
  *reported user*, not the message: 1st confirmed violation = warning only, 2nd = 24-hour
  chat restriction, 3rd = 3 days, 4th and beyond = 7 days (repeats). A **permanent**
  restriction is never applied automatically — that's an admin-only manual action for
  severe or repeated cases.
- **Dismiss** — records the outcome on the user's cross-case moderation profile without
  touching their warning count.
- **Manually restrict or clear a restriction** — independent of the case flow, e.g. for a
  single severe incident.

There's also a lightweight **auto-moderation** shortcut: if **3 distinct residents**
report the same message within a 24-hour window, it auto-resolves through the same
warning escalation ladder as a manual "Send Warning" — requiring *distinct* reporters
(not just report count) makes this much harder to abuse, since `MessageReport` also
enforces at most one report per user per message, so one person re-reporting can never
trigger it alone. A background sweep (`scripts/chatModerationScheduler.js`) also
periodically clears expired temporary restrictions, since the mobile app checks the raw
restriction flag directly and wouldn't otherwise pick up an expiry on its own.

### Panel Q&A

**Q: "May chat feature din pala kayo — paano nyo pinipigilan ang abuse dito?"**
> "Real scenario: may residenteng nag-flag ng isang message dahil sa inappropriate
> content o spam. Lumalabas ito sa Chat Monitoring queue. Ire-review ng staff ang case
> — titingnan nila ang message at ang surrounding conversation context — tapos pipiliin
> nila kung magpapadala ng warning (na automatic na escalates — 1st offense warning
> lang, 2nd 24-hour restriction, 3rd 3 days, 4th pataas ay 7 days) o i-dismiss kung wala
> namang problema. May auto-moderation din: kung 3 magkaibang residente ang nag-report
> ng parehong message sa loob ng isang araw, automatic itong nagre-resolve sa parehong
> paraan ng manual warning — hindi na kailangan mag-click pa ng staff."

**Q: "Paano hindi maabuse ang report feature — halimbawa, magsama-sama ang mga tao para
i-frame ang isang tao?"**
> "Isang report lang ang puwede ng bawat resident sa isang message — enforced ito sa
> backend mismo via unique index, hindi lang UI guard — kaya hindi puwedeng paramihin
> ng iisang tao ang bilang ng report. Ang 3-distinct-reporter auto-trigger ay
> nangangailangan ng tatlong magkaibang tao talaga, kaya mas mahirap i-abuse kumpara sa
> isang taong lang na mag-isa ang gumagawa."

**Q: "Ano ang pagkakaiba ng temporary at permanent restriction — sino nagdedecide?"**
> "Ang temporary restrictions (24h/3d/7d) ay automatic na nag-e-escalate habang
> nadadagdagan ang violations — hindi na kailangang mag-decide pa ang admin ng duration.
> Ang permanent restriction naman ay hindi kailaman automatic — deliberate manual action
> ito na ginagawa ng reviewer para sa severe o paulit-ulit na kaso."

---

## 10. Audit Logs Module (System Admin)

**How it works:** Every significant action across the system — account changes, alert
actions, report approve/reject, evacuation center occupancy updates, and similar staff
activity — is logged with who performed it and when. It's the authoritative record for
post-incident review, distinct from staff memory of what happened.

### Panel Q&A

**Q: "Paano nyo mapapatunayan kung sino talaga ang gumawa ng isang mali sa system —
halimbawa nag-delete ng report na hindi dapat?"**
> "Bawat significant action — account changes, alert actions, report approve/reject,
> evacuation center occupancy updates — ay naka-log sa Audit Logs, kasama kung sino at
> kailan. Kung may tanong sa post-incident review — halimbawa, 'bakit na-reject ang
> report na ito noong nangyari ang baha' — puwedeng balikan ito sa audit trail, hindi
> lang sa memorya ng staff. Ito rin ang unang tinitingnan kung may accountability
> question matapos ang isang aktwal na disaster response."

---

## 11. AI Model Performance Module (System Admin)

**How it works:** A dedicated page showing the hazard-prediction model's version history
and real-world outcome tracking — how its predictions have actually performed over time,
not just offline validation metrics. The same summary panel is also embedded read-only
inside CDRRMO's Alerts page, so CDRRMO can sanity-check the model without navigating away
from where they issue alerts.

### Panel Q&A

**Q: "Bakit kailangan pa ng hiwalay na page para dito — di ba pwede na lang sabihin sa
Alerts page?"**
> "Nakikita naman siya doon — read-only, embedded sa CDRRMO Alerts page — pero ang
> System Admin ay may full standalone page dahil ang pag-track ng model version history
> at real-world outcomes over time ay isang platform-monitoring concern, iba sa
> moment-to-moment na desisyon na ginagawa ng CDRRMO habang nag-i-issue ng alert."

---

## 12. Notifications (Push) Module

**How it works:** Browser/mobile push notifications are the delivery mechanism, not
in-app polling — a subscribed user gets an alert even if the app/tab is closed.

| Event | Who gets notified |
|---|---|
| New official hazard alert (typhoon, flood, earthquake, landslide, manual) | Everyone — staff browsers and resident phones |
| A citizen report is approved into an alert | Everyone — staff browsers and resident phones |
| A new report is submitted, awaiting review | Staff browsers only |
| A new resource request needs review | Staff browsers only |

Notifications for new reports are also **barangay-scoped where the underlying data
allows it** — CDRRMO always gets notified; a Barangay Official is only notified for
reports whose reporting resident belongs to their assigned barangay.

### Panel Q&A

**Q: "Paano kung naka-close ang app ng resident, makukuha pa ba niya ang alert?"**
> "Oo — gamit ang browser/mobile push notification, makukuha pa rin nila ang alert
> kahit sarado ang app, kasi push notification ang delivery mechanism, hindi in-app
> polling. Halimbawa: may bagong official typhoon alert na naissue — makakatanggap
> kaagad ang lahat, staff browsers at resident phones. Pero may distinction: 'bagong
> report na naghihintay ng review' ay staff-only ang notification — hindi kailangang
> alarmahin ang buong publiko habang unverified pa ang isang report."

---

## 13. SMS Fallback (Proposed — be upfront about status)

**How it works (as designed, not yet deployed):** The existing offline queue on a
resident's device still depends on an eventual `online` event to flush — if a resident
has cell signal but no WiFi/data at all, they still can't submit through the app itself.
The proposed fix is a local SMS gateway: a spare Android phone with a prepaid SIM,
connected to the barangay WiFi, acting as a webhook receiver. A resident could text a
report in plain language (e.g. `may sunog dito sa san roque, tulong po`), parsed by a
keyword-based, bilingual (English/Tagalog) parser designed not to crash on unstructured
input — a low-confidence match gets flagged "Needs Review" instead of being silently
dropped.

### Panel Q&A

**Q: "Paano kung walang WiFi/data ang resident pero may signal — completely stuck na ba
siya?"**
> "Dito papasok ang gap na tinukoy at dinisenyo na namin: ang existing offline queue sa
> phone/browser ng resident ay umaasa pa rin sa `online` event eventually — kung walang
> WiFi at walang mobile data talaga, hindi pa rin makaka-submit ang resident kahit may
> cell signal siya. Ang plano — isang local SMS gateway, spare Android phone plus
> prepaid SIM, konektado sa parehong barangay WiFi, tumatakbo bilang webhook receiver —
> ay hahayaan ang resident na magtext ng report gamit ang sariling salita, at ang parser
> namin ay keyword-based, bilingual (English/Tagalog), at designed para hindi mag-crash
> kahit hindi structured ang format — kung hindi confident ang match, naka-flag ito
> bilang 'Needs Review' imbes na basta i-drop. **Status ngayon: fully designed at
> documented, hindi pa naka-deploy** — kung tatanungin kung gumagana na ito live, ito
> ang tamang sagot: nasa design/pending-implementation stage, may clear spec na, pero
> hindi pa ito working code sa production."

---

## Quick reference — what to say if you get cornered

| If the panel says... | Anchor your answer on... |
|---|---|
| "Paano kung walang internet?" | Local Mode (barangay hall laptop = server + AP) → auto-sync in ~5 min → client-side offline queue → proposed SMS fallback |
| "Bakit 'smart' tawag nyo?" | Not just AI — the system design itself anticipates outages, degrades gracefully, and syncs automatically without manual staff action |
| "Paano kung mali ang AI?" | AI alerts are visually distinct, gated behind rule-based alerts, off by default, never auto-escalate to "evacuate" |
| "Sapat ba ang datos nyo?" | Be honest about cold start; explain the historical dataset backfill and the real AUC numbers, including the class-imbalance caveat |
| "Paano nyo pinipigilan ang chat abuse?" | Report-driven queue + escalation ladder (warning → 24h → 3d → 7d) + 3-distinct-reporter auto-trigger; permanent restriction is manual-only |
| "Sino may access sa ano?" | Three roles: System Admin (platform only, zero ops), CDRRMO (city-wide ops), Barangay Official (own barangay only, enforced server-side) |
| "Ano ang limitations nyo?" | Point-radius barangay boundaries (no polygon data), single model per hazard type, SMS fallback not yet deployed, unregistered/older reports invisible to barangay officials |

**General defense tip:** when a panelist finds a real limitation, don't argue it away —
name it, explain why it's a reasonable tradeoff given time/data/scope, and say what the
next iteration would do.

---

*Companion file: `etelly-mobile/MOBILE_SYSTEM_GUIDE_QA.md` for the resident-facing mobile
app. See also `USER_GUIDE.md` (step-by-step staff usage) and `PANEL_DEFENSE_QA.md`
(original module Q&A this file consolidates and extends).*
