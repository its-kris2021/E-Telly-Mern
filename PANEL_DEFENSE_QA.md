# E-Telly — Panel Defense Q&A Guide

> **System:** E-Telly — *"A Smart Progressive Web and Mobile Application for Disaster
> Preparedness and Communication System Using Decentralized Network"*
> **Audience of this doc:** the student defending the capstone in front of the panel.
> **Format:** grouped by module. Each module has 2–3 likely panel questions, written the
> way a panelist actually asks them (mixed Filipino/English), with a real-scenario answer
> you can say out loud — not a textbook definition.

Use this together with `USER_GUIDE.md` (how staff use the dashboard) and
`AI_HAZARD_PREDICTION.md` / `SMS_FALLBACK_PLAN.md` (technical depth, if a panelist digs
deeper into a specific answer).

---

## 0. The signature question — "Paano SMART kung wala namang internet?"

> **Panel:** *"What if there's no internet, ano mangyayari? Tapos paano nyo matatawag na
> SMART ang system nyo kung ganon?"*

**Answer:**

"Internet outages talaga ang inaasahan namin, sir/ma'am — hindi exception, design
assumption namin siya mismo, dahil disaster ang use case. So merong tatlong layers ang
system para hindi tumigil ang operations:

1. **Barangay Hall 'Local Mode.'** May laptop kami sa barangay hall na nagsisilbing
   parehong server at WiFi access point (`ETelly-BagongNayon`). Kapag walang internet,
   ang router lang ang kailangan may kuryente — walang kailangang internet connection.
   Mag-connect lang ang residente sa WiFi na ito, tapos direkta niyang maisusubmit ang
   emergency report sa laptop ng barangay official — real-time pa rin, kaso local lang
   muna, hindi pa naka-cloud.
2. **Automatic sync pagbalik ng internet.** Sa oras na makadetect ulit ng internet ang
   laptop, automatic siyang mag-sync sa CDRRMO cloud database within 5 minutes — walang
   kailangang i-click ng barangay official, walang manual export. Ito ang
   `syncToCloud.js` scheduler namin — nagcheck every 30 seconds kung nag-online na, tapos
   may catch-all sync din every 5 minutes habang naka-online na, para masigurong walang
   maiiwan.
3. **Client-side offline caching.** Kung ang resident mismo ang naputol ng internet
   (hindi lang ang barangay hall), naka-cache na sa kanyang phone/browser ang huling
   nakuhang hazard data at alerts (IndexedDB), at kung magsubmit siya ng alert o report
   habang offline, naka-queue muna ito sa device niya at automatic na sinend once bumalik
   ang connection.

Kaya ang tawag naming 'decentralized' ay literal: hindi kailangan ng isang central
internet-connected server para gumana ang core na function — pag-report at pag-alert —
sa loob ng isang barangay. At ang tawag naming 'smart' ay hindi lang sa AI prediction
model namin — kasama rin dito ang design decision na alam ng system na puwedeng mawalan
ng internet sa gitna ng disaster, at meron siyang planong tumakbo pa rin sa ganong
sitwasyon, imbes na basta mag-crash o mag-freeze.

**Kung tanungin ng follow-up 'paano kung wala talagang WiFi/internet kahit sa barangay
hall, at wala pang laptop na naka-setup?'** — dito papasok ang proposed SMS fallback
namin: isang spare Android phone na may prepaid SIM, naka-connect sa parehong barangay
WiFi, tumatakbo bilang local SMS gateway. Kung may cell signal ang resident pero walang
data/WiFi, puwede siyang magtext ng report (halimbawa: `FIRE SAN ROQUE may sunog malapit
sa palengke`), at ang gateway phone ang magrelay nito sa barangay server sa loob mismo ng
LAN — walang kailangang cloud SMS API o subscription. [Status: designed at documented sa
`SMS_FALLBACK_PLAN.md`, hindi pa naka-deploy — honest disclosure kung tatanungin kung
gumagana na ito ngayon.]"

**Why this answer works:** it doesn't claim the system *never* needs internet — it shows
three concrete, layered fallbacks (WiFi AP → auto-sync → client cache/queue → SMS), each
tied to an actual file/mechanism, and it's honest about what's implemented vs. proposed.

---

## 1. Offline / Local Mode & Decentralized Network

> **Panel:** *"Bakit laptop pa kailangan sa barangay hall? Di ba kaya lang naman gawin sa
> cloud lahat?"*

**Answer:** "Kung purely cloud-dependent ang system, sa sandaling maputol ang internet ng
buong lugar — na madalas mangyari sa bagyo o lindol — walang paraan ang mga residente na
mag-report o makatanggap ng alert. Ang laptop sa barangay hall ay parehong **server**
(Node.js/Express + local MongoDB, `etelly_local` database) at **WiFi access point**.
Kaya kahit walang internet, gumagana pa rin ang core loop: resident submits report →
barangay official sees it live sa dashboard → barangay official can still coordinate
evacuation, kasi naka-store lokal lang muna. Ito ang binibigyang-diin ng amber banner na
'**Local Mode Active**' sa dashboard — sinasabi niya sa barangay official na naka-local
sila, at automatic na susync 'yan sa CDRRMO once bumalik ang internet."

> **Panel:** *"Paano kung may dalawang barangay hall na parehong naka-Local Mode — di ba
> magkaiba ang datos nila hanggang mag-sync?"*

**Answer:** "Tama po, at sinasadya iyon — bawat barangay hall ay independent local
instance, kaya kung maputol ang internet ng buong Antipolo, hindi nakadepende ang isang
barangay sa kalagayan ng kapitbahay niyang barangay. Sa sandaling bumalik ang internet sa
alinman sa mga hall, doon lang mag-sync ang datos niya papuntang shared CDRRMO cloud
database — walang conflict dahil bagong reports lang ang isinesend, at naka-tag ang
bawat report kung saan siya galing (`source: online` vs mesh/offline-originated), kaya
malinaw kung anong barangay talaga ang pinagmulan."

---

## 2. Alerts Module

> **Panel:** *"May AI daw kayo — pero paano kung mali ang AI prediction, may masasaktan ba
> dahil dito?"*

**Answer scenario:** "Halimbawa: mataas ang predicted flood risk ng AI model para sa
Barangay Calawis kinabukasan. Hindi agad ito nagiging emergency evacuation alert. Una,
kinukumpara muna namin ito sa existing **rule-based** alert — kung meron nang
rule-based (PAGASA rainfall threshold + soil moisture) alert na parehas o mas mataas ang
severity, hindi na gagawa ang AI ng duplicate. Pangalawa, ang AI-generated alert ay
laging naka-mark na `source: ai` at may dashed border sa map (di solid line, di
kagaya ng confirmed rule-based alerts) plus 'not yet confirmed' label at confidence % —
kaya visually iba ang treatment, hindi ito pinapakita bilang parehong authority sa isang
official evacuation order. At default, **OFF** muna ang AI Predictions layer sa map —
opt-in lang ito habang binubuild pa namin ang confidence sa model. So kung mali man ang
prediction, ang worst case ay isang soft, non-urgent na push notification, hindi isang
mandatory evacuation."

> **Panel:** *"Sino magdedecide kung 'critical' na ba dapat itawag ang alert?"*

**Answer:** "Ang CDRRMO o barangay official ang gumagawa ng official alert, hindi
automated ang buong desisyon — sila mismo ang pumipili ng severity level mula sa
watch → warning → critical → evacuate. Sa sandaling isubmit nila ito, awtomatiko na
itong lalabas sa map, sa alert feed, at magpapadala ng push notification sa mga phone ng
residente at sa subscribed browsers ng ibang staff."

---

## 3. Reports Module (Citizen Emergency Reports)

> **Panel:** *"May nagreport na fake emergency — paano nyo mahuhuli?"*

**Answer:** "Walang automatic na 'approve' — laging dumadaan muna sa **Pending** status
ang bagong report bago ito makita ng publiko bilang official alert. Ang barangay official
(kung sa loob ng kanyang barangay) o CDRRMO (kung city-wide) ang mag-review: titingnan
nila ang photo, hazard type, severity, description, at exact location ng report bago
piliin ang **Approve**, **Reject**, o direktang **Resolve**. Kung obvious na fake o
duplicate, **Reject** — hindi ito naglalabas ng alert at wala itong epekto sa ibang
residente. Approved lang ang puwedeng lumikha ng matching alert."

> **Panel:** *"Ano ang nakikita ng barangay official — lahat ba ng reports sa buong
> Antipolo?"*

**Answer:** "Hindi po — scoped siya sa kanyang **assigned barangay** lang. Kapag gumawa
ng account ang System Admin para sa isang Barangay Official, required talaga na piliin
ang barangay na kanyang huhawakan; hindi lang ito default label, kundi filter mismo sa
backend (`reporterBarangayKey`) — kaya kung ang report ay resolved sa ibang barangay,
hindi ito lalabas sa dashboard ng officialng hindi kaugnay. Ang CDRRMO lang ang
nakakakita ng lahat ng barangay, dahil city-wide talaga ang saklaw nila."

---

## 4. Hazard Map Module

> **Panel:** *"Bakit hazard map pa kailangan kung may alerts na naman kayo?"*

**Answer:** "Ang alert ay 'ito na ang nangyayari, kumilos na' — ang map ay 'ito ang buong
context bago ka gumawa ng desisyon.' Halimbawa, bago mag-issue ng flood alert sa isang
barangay, tinitingnan muna ng CDRRMO ang layer control panel: rainfall/river forecast
overlay, typhoon track kung meron, recent earthquake activity, at kung may na-approve na
citizen reports doon mismo sa lokasyon. Parehong live hazard data ito na siya ring
pinagbabatayan ng mobile app ng resident para sa evacuation routing — kaya iisa lang ang
'source of truth,' hindi magkaiba ang nakikita ng staff at ng resident."

> **Panel:** *"'Point-radius' lang ang barangay boundaries nyo, tama ba? Hindi ba mali
> yun?"*

**Answer:** "Tama po, walang existing official barangay polygon (boundary shapefile) na
available sa amin o online, kaya centroid (isang GPS point per barangay) ang ginamit
namin bilang approximation — this is a stated, documented limitation, hindi bug. Ang
epekto: puwedeng may edge-case na resident na malapit sa boundary ng dalawang barangay na
mali ang na-assign na barangay sa kanyang report. Kung lalakihin pa ang system, ang
susunod na hakbang ay kumuha ng totoong polygon data mula sa LGU o NAMRIA."

---

## 5. AI Hazard Prediction Module

> **Panel:** *"Bakit logistic regression lang, hindi mas advanced na model gaya ng neural
> network?"*

**Answer:** "Sadyang pinili namin ang mas simpleng model dahil sa laki ng datos namin —
tens to low hundreds ng labeled barangay-days lang ang realistic para sa isang city, isang
capstone deployment. Kung gagamit kami ng random forest o deep neural network sa laki ng
datos na ganito, malaki ang tsansang mag-**overfit** — parang cramming para lang sa
laging parehong exam, hindi talaga natututo ng totoong pattern. Ang L2-regularized
logistic regression ay tama ang complexity para sa dataset size namin, at bonus pa: fully
auditable — puwede naming ipakita kung anong specific feature (halimbawa: 6-hour
rainfall, soil moisture, distance sa landslide-prone na barangay) ang nag-drive sa isang
prediction. Importante ito para sa isang disaster-alerting feature — hindi namin
gustong 'black box' lang ang dahilan kung bakit may nire-recommend na alert."

> **Panel:** *"May sapat na ba kayong datos para sabihing gumagana ang AI nyo?"*

**Answer:** "Real scenario: sa una, cold-start problem talaga ito — kakainstall pa lang
ng snapshot pipeline, walang training data. Ang sinagot namin dito ay hindi maghintay ng
buwan-buwan sa live data lang — ginamit namin ang existing historical dataset ng
Antipolo City (`Capstone_Antipolo-Dataset.xlsx`, 2020–2025, 399 rows ng situational
reports) para i-backfill ang training set kaagad. Pagkatapos ng import at
backfill, nakapag-train na kami ng bersyon 1 ng model para sa flood at landslide, at may
AUC na 0.91 (flood) at 0.94 (landslide) sa offline cross-validation — malayo sa random
guessing (0.5). Pero honest din kami: sa 0.5 default threshold, halos zero ang naka-flag
dahil bihira lang talaga ang positive cases (0.5% ng barangay-days) — kaya may
`findOptimalThreshold()` kami na humahanap ng tamang cutoff base sa totoong data,
imbes na basta 0.5. At hindi rin siya nagpapalit ng human judgment — laging naka-gate ang
AI alert laban sa existing rule-based alert, at naka-off by default ang layer hangga't
hindi pa napapatunayan ang reliability niya sa totoong field outcomes."

---

## 6. Evacuation Centers Module

> **Panel:** *"Paano malalaman ng resident kung puno na ang evacuation center bago pa
> siya pumunta?"*

**Answer:** "Real-time ang occupancy tracking — sa sandaling i-update ng barangay
official ang bilang ng evacuees sa isang center (dumarating man o umaalis), agad itong
nare-reflect sa mobile app ng residente bilang 'Available,' 'Almost Full,' o 'Full'
status. So kung isang pamilya ang nakikita na 'Full' na ang pinakamalapit na center bago
pa sila umalis ng bahay, puwede na silang pumili ng ibang center sa halip na
matagpuang puno pagdating nila. Lahat ng occupancy change ay naka-log din para sa audit —
kung mag-dispute man kung sino ang nag-update, may record."

---

## 7. Safety Tips Module

> **Panel:** *"Bakit kailangan pa 'offline-readable' ang safety tips, di ba app naman
> ito?"*

**Answer:** "Kasi mismo sa oras na kailangan mo ang first-aid o earthquake safety tip —
habang nangyayari ang disaster — ay ang oras na kadalasang wala kang matatag na
internet connection. Kaya ang content ng Safety Tips ay naka-cache sa device ng
resident, hindi kinakailangang mag-fetch ulit sa server bawat pagbukas. CDRRMO/Barangay
official ang nag-maintain ng content mula sa dashboard, pero once na-download na ito ng
resident, gumagana ito kahit walang signal."

---

## 8. User Management Module (System Admin)

> **Panel:** *"Sino gumagawa ng account ng bagong CDRRMO staff? Puwede bang mag-sign up
> lang sila mismo?"*

**Answer:** "Hindi — walang self-registration para sa CDRRMO o Barangay Official. Ang
System Admin lang ang may access dito, dahil sensitibo ang role na ito — direktang
naka-attach ito sa disaster-response authority. Halimbawa: kapag gumawa ng Barangay
Official account, required talagang piliin ang assigned barangay bago pa man makapag-
submit ang form — kung hindi, hindi ito tatanggapin. Ito ang nagseset kung anong reports
at evacuation centers makikita ng officialng ito. Bawat bagong account ay may
auto-generated 16-character password, kaya hindi kailangang mag-imbento ng password ang
System Admin, at required agad ang first-login password reset."

---

## 9. Chat Monitoring Module (System Admin)

> **Panel:** *"May chat feature din pala kayo — paano nyo pinipigilan ang abuse dito?"*

**Answer:** "Real scenario: dalawang residente ang nag-uusap sa loob ng app — pati ang
P2P 'nearby device' chat (offline, device-to-device, walang internet) — kung
ma-flag ang isang conversation (halimbawa dahil sa inappropriate content o spam),
lumalabas ito sa Chat Monitoring queue ng System Admin. Ire-review nila ang case tapos
markahan itong **Resolved** kung wala namang problema, o **Dismissed**/actioned kung
kailangan. Ang queue mismo ay dinisenyo para lang ipakita ang mga kailangan pa ng
action — hindi nabubara ng lumang, resolved na cases."

---

## 10. Audit Logs Module (System Admin)

> **Panel:** *"Paano nyo mapapatunayan kung sino talaga ang gumawa ng isang mali sa
> system — halimbawa nag-delete ng report na hindi dapat?"*

**Answer:** "Bawat significant action — account changes, alert actions, report
approve/reject, evacuation center occupancy updates — ay naka-log sa Audit Logs, kasama
kung sino at kailan. Kung may tanong sa post-incident review — halimbawa,
'bakit na-reject ang report na ito noong nangyari ang baha' — puwedeng balikan ito sa
audit trail, hindi lang sa memorya ng staff. Ito rin ang unang tinitingnan kung may
accountability question matapos ang isang aktwal na disaster response."

---

## 11. Notifications (Push) Module

> **Panel:** *"Paano kung naka-close ang app ng resident, makukuha pa ba niya ang
> alert?"*

**Answer:** "Oo — gamit ang browser/mobile push notification (naka-subscribe sila kapag
in-enable nila ito), makukuha pa rin nila ang alert kahit sarado ang app, kasi push
notification ang delivery mechanism, hindi in-app polling. Halimbawa: may bagong
official typhoon alert na naissue — makakatanggap kaagad ang lahat, staff browsers at
resident phones. Pero may distinction: 'bagong report na naghihintay ng review' ay
staff-only ang notification — hindi kailangang alarmahin ang buong publiko habang
unverified pa ang isang report."

---

## 12. SMS Fallback (Proposed Module — be upfront about status)

> **Panel:** *"Paano kung walang WiFi/data ang resident pero may signal — completely
> stuck na ba siya?"*

**Answer:** "Dito papasok ang gap na tinukoy at dinisenyo na namin: ang existing offline
queue (IndexedDB sa phone/browser ng resident) ay umaasa pa rin sa `online` event
eventually — kung walang WiFi at walang mobile data talaga, hindi pa rin makaka-submit
ang resident kahit may cell signal siya. Ang plano — isang local SMS gateway (spare
Android phone + prepaid SIM, konektado sa parehong barangay WiFi, tumatakbo bilang
webhook receiver) — ay hahayaan ang resident na magtext ng report gamit ang sariling
salita (`may sunog dito sa san roque, tulong po`), at ang parser namin ay
keyword-based, bilingual (English/Tagalog), at designed para hindi mag-crash kahit
hindi structured ang format — kung hindi confident ang match, naka-flag ito bilang
'Needs Review' imbes na basta i-drop. **Status ngayon: fully designed at documented, hindi
pa naka-deploy** — kung tatanungin kung gumagana na ito live, ito ang tamang sagot: nasa
design/pending-implementation stage, may clear spec na, pero hindi pa ito working code sa
production."

---

## Quick reference — what to say if you get cornered

| If the panel says... | Anchor your answer on... |
|---|---|
| "Paano kung walang internet?" | Local Mode (barangay hall laptop = server + AP) → auto-sync in 5 min → client-side offline queue → proposed SMS fallback |
| "Bakit 'smart' tawag nyo?" | Not just AI — the *system design itself* anticipates outages, degrades gracefully, and syncs automatically without manual staff action |
| "Paano kung mali ang AI?" | AI alerts are visually distinct, gated behind rule-based alerts, off by default, never auto-escalate to "evacuate" |
| "Sapat ba ang datos nyo?" | Be honest about cold start; explain the historical dataset backfill and the real AUC numbers, including the class-imbalance caveat |
| "Ano ang limitations nyo?" | Point-radius barangay boundaries (no polygon data), single model per hazard type (not per-barangay), SMS fallback not yet deployed |

**General defense tip:** when a panelist finds a real limitation, don't argue it away —
name it, explain why it's a reasonable tradeoff given time/data/scope, and say what the
next iteration would do. That's what the docs above (`AI_HAZARD_PREDICTION.md`, this
guide) already do — mirror that tone in the live defense.
