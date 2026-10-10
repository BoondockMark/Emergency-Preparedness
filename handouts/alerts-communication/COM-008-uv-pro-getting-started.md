---
code: COM-008
title: BTECH UV-PRO Getting Started
section: Alerts & Communication
sectionNumber: 2
status: draft
version: 0.2
lastReviewed: 2026-10-09
reviewers:
  editor: unassigned
  subjectMatter: unassigned
sources:
  - type: local
    title: Heights 6 channel settings and directed-net practices
    provider: La Habra Heights Fire Watch repository
    location: handouts/alerts-communication/COM-002-heights-6-radio-communications.md
    receivedDate: 2026-10-09
  - type: local
    title: Heights 6 frequencies, DCS, and channel-edit gesture confirmed by project owner
    provider: Fire Watch project owner
    location: Project conversation, October 9, 2026; channel-setting and press-and-hold confirmations
    receivedDate: 2026-10-09
  - type: local
    title: Android UV-PRO app screen captures and illustrated reference
    provider: Fire Watch project owner
    location: assets/handouts/COM-008/SOURCE-NOTES.md
    receivedDate: 2026-10-09
  - type: web
    title: BTECH UV-PRO User Manual, Revision 3
    organization: BTECH
    url: https://baofengtech.com/wp-content/uploads/2024/08/BTECHpackaging_UVPRO_Manual_Rev3.pdf
    accessDate: 2026-10-09
  - type: web
    title: BTECH UV-PRO product and programming information
    organization: BTECH
    url: https://baofengtech.com/product/uv-pro/
    accessDate: 2026-10-09
---
<p class="lede">Set up a BTECH UV-PRO for Heights 6 using the phone app, then check that the radio works on its own.</p>

<div class="warning warning--caution"><strong>Draft for training review.</strong> A radio lead must check the equipment authorization, operating settings, and completed setup before duty. This guide programs only Heights 6.</div>

## 1. Prepare the radio and phone

<div class="checklist"><ul>
<li>UV-PRO, correct antenna, battery, and supplied charging equipment</li>
<li>Compatible Android phone or iPhone with Bluetooth</li>
<li>BTECH UV Programmer app from the manufacturer's official app links</li>
<li>Your assigned callsign and the radio lead's current channel plan</li>
</ul></div>

<ol class="procedure">
<li><strong>Fit the battery and antenna</strong> following the supplied instructions. Check for damage. Keep your fingers away from the side <strong>PTT</strong> (push-to-talk) button.</li>
<li><strong>Charge the battery.</strong> The removable battery charges directly by USB-C. Use the supplied equipment and follow its charging instructions.</li>
<li><strong>Power on.</strong> Turn the top <strong>Power/Volume</strong> knob clockwise past the click. Continue clockwise to increase volume. Turning counterclockwise past the click powers off.</li>
<li><strong>Install BTECH UV Programmer.</strong> BTECH's manual identifies this app for both Google Play and the Apple App Store. Enable Bluetooth on your phone.</li>
</ol>

<div class="local-info">
<p><strong>Heights 6 — confirmed by the project owner, October 9, 2026.</strong></p>
<table>
<thead><tr><th scope="col">Field</th><th scope="col">Enter</th></tr></thead>
<tbody>
<tr><th scope="row">Title</th><td>Heights 6</td></tr>
<tr><th scope="row">RX Freq — listen</th><td>462.38750 MHz</td></tr>
<tr><th scope="row">TX Freq — transmit</th><td>467.38750 MHz</td></tr>
<tr><th scope="row">RX CTCSS/DCS</th><td>DCS 331N</td></tr>
<tr><th scope="row">TX CTCSS/DCS</th><td>DCS 331N</td></tr>
</tbody>
</table>
</div>



<div class="sources">Sources: BTECH manual, pp. 4–5, 11–15; product page; owner confirmation. Links: page 6.</div>

<!-- pagebreak -->

<p class="lede">Connect to your own radio, then choose an unused memory. The captures show Android with radio firmware 0.9.3; iPhone and newer layouts may differ.</p>

## 2. Connect and open the channel editor

<ol class="procedure">
<li><strong>Put the radio in pairing mode if needed.</strong> In the radio menu, use <strong>Connections → Pairing</strong>. Keep the radio powered on and near the phone.</li>
<li><strong>Find the radio in the app.</strong> The manual's connection screen lists <strong>Bindable Device</strong>; select your UV-PRO. If several radios are nearby, confirm which one is yours with the lead.</li>
<li><strong>Check the connection.</strong> The app should show the radio's operating screen and channel list. If it does not, open <strong>Connection management</strong> in device settings and check the selected device. Do not start editing a disconnected or unidentified radio.</li>
<li><strong>Open the channel panel.</strong> In the supplied Android layout, tap the <strong>three-line menu at the upper left</strong> of the main map screen. The panel contains a numbered channel grid, volume slider, and TX Power / Work Mode controls.</li>
<li><strong>Choose an unused tile.</strong> Use the lead's assigned channel group and an empty numbered memory. The example uses tile 1, but do not overwrite it if your radio already uses it.</li>
<li><strong>Press and hold the tile.</strong> In the menu that appears, tap <strong>Edit channel</strong>. The other choices shown are <strong>Bind network channel</strong> and <strong>Delete</strong>; neither is needed for this setup.</li>
</ol>

## Two menus with different jobs

<table>
<thead><tr><th scope="col">Where to open it</th><th scope="col">What it does</th></tr></thead>
<tbody>
<tr><th scope="row">Three-line menu</th><td>Shows the channel tiles. Press and hold a tile to edit it.</td></tr>
<tr><th scope="row">Gear in the channel panel</th><td>Opens device settings, including Connection management and Channel &amp; Groups.</td></tr>
<tr><th scope="row">Three-dot menu → Device settings</th><td>Another device-settings route shown in the captures.</td></tr>
<tr><th scope="row">Global settings</th><td>Contains phone/app options. It is not the channel-tile editor used here.</td></tr>
</tbody>
</table>

<div class="warning warning--caution"><strong>Caution: preserve existing settings.</strong> Do not use factory reset, delete channels, import an unknown list, or update firmware while following this guide. Older manual pictures place the three-line menu at the lower left; use the control's symbol to recognize it.</div>

<div class="sources">Sources: BTECH UV-PRO Manual, pp. 11–15 and 22; supplied Android captures 2, 3, 5, and 9. The project owner confirmed press-and-hold opens the channel menu.</div>

<!-- pagebreak -->

<p class="lede">Give the memory a recognizable title, then enter the receive and transmit frequencies separately.</p>

## 3. Enter the name and frequencies

<ol class="procedure">
<li><strong>Tap Title.</strong> Enter <strong>Heights 6</strong>. The captured example says <strong>LHH FW</strong>; it is not a different frequency assignment.</li>
<li><strong>Tap RX Freq.</strong> Choose <strong>FM</strong> if the frequency dialog asks for a mode. Enter <strong>462.38750 MHz</strong>, then confirm the dialog. RX is the frequency your radio listens to.</li>
<li><strong>Tap TX Freq.</strong> Use <strong>FM</strong> and enter <strong>467.38750 MHz</strong>, then confirm. TX is the frequency your radio transmits on. Do not reverse RX and TX.</li>
</ol>

<figure class="figure figure--full figure--contain" aria-labelledby="app-reference-caption">
<img src="../assets/handouts/COM-008/app-screen-reference.png" alt="Adapted UV-PRO channel editor shows SAVE, separate RX and TX frequencies, and separate DCS fields; device settings includes the channel-group control.">
<figcaption id="app-reference-caption"><strong>Figure 1.</strong> Illustrated screen reference adapted from supplied captures: channel editor on the left, device-settings choices on the right. <span class="credit">Original captures: project owner; illustrated adaptation: OpenAI.</span></figcaption>
</figure>

<div class="warning warning--caution"><strong>Use the channel card, not every example digit.</strong> The captured TX field reads <strong>467.387506 MHz</strong>. Enter the confirmed target <strong>467.38750 MHz</strong>. If extra digits return after saving, have the radio lead check the stored value; the captures do not establish why they appear.</div>

<p><strong>Compare:</strong> RX starts with <strong>462</strong>, TX with <strong>467</strong>; both have <strong>.38750</strong> and use FM. <strong>462.3875</strong> and <strong>462.38750</strong> are the same frequency. Dropping a final zero is different from adding a nonzero digit.</p>

<div class="sources">Sources: project-owner frequency confirmation and supplied channel-edit capture 6. Figure 1 is an illustrated adaptation, not a pixel-identical screenshot crop.</div>

<!-- pagebreak -->

<p class="lede">Set both DCS fields, review the remaining channel options, and save the entry.</p>

## 4. Set DCS and save

<ol class="procedure">
<li><strong>Tap RX CTCSS/DCS.</strong> Choose the DCS entry containing <strong>331N</strong>. Here, <strong>N</strong> means normal polarity. Confirm the selection.</li>
<li><strong>Tap TX CTCSS/DCS.</strong> Select the same <strong>331N</strong> entry and confirm. Check it separately; setting RX does not prove TX is correct.</li>
<li><strong>Recognize the app label.</strong> The supplied editor displays <strong>DCS-331N/465I</strong> in each field. This is one displayed selection label. Use the entry containing <strong>331N</strong>; do not program an additional code or substitute <strong>331I</strong>.</li>
<li><strong>Check bandwidth and power with the lead.</strong> The captured example shows <strong>Bandwidth 12.5KHz</strong> and <strong>TX Power High</strong>. These are captured settings, not independent authorization to use High power. Set the values required by the lead's channel plan.</li>
<li><strong>Check the switches below the fields.</strong> Keep <strong>Talk Around</strong> and <strong>Reverse Frequency</strong> off for the RX/TX assignment on page 1. Leave scan, lockout, and other optional settings as directed by the lead.</li>
<li><strong>Tap SAVE at the upper right.</strong> Keep the radio connected while saving. Do not tap <strong>SHARE</strong> or <strong>DELETE</strong>. If an error appears or the connection drops, reconnect and verify the entry before proceeding.</li>
</ol>

<div class="warning warning--caution"><strong>Caution: Talk Around changes repeater operation.</strong> BTECH's manual says Talk Around makes TX and RX the same frequency. Heights 6 uses separate frequencies; do not enable this option for the setup shown here.</div>

## If editing is refused

<p>Device settings → <strong>General settings</strong> includes <strong>Lock channel data</strong>. Ask the lead whether this is preventing edits before changing a lock. Do not solve a locked channel by factory-resetting the radio.</p>

## Save checkpoint

<div class="checklist"><ul>
<li>Both DCS fields contain <strong>331N</strong>.</li>
<li>Power and bandwidth match the lead's plan.</li>
<li>Talk Around and Reverse Frequency are off.</li>
<li>SAVE completed without a reported connection or save error.</li>
</ul></div>

<div class="sources">Sources: supplied captures 6 and 7; BTECH UV-PRO Manual, p. 31 (TX/RX subtone and Talk Around). Frequencies and normal-polarity DCS confirmed by the project owner.</div>

<!-- pagebreak -->

<p class="lede">Reopen the memory, select it on the radio, and verify it without relying on the phone.</p>

## 5. Verify what was stored

<ol class="procedure">
<li><strong>Reopen the saved entry.</strong> Return to the channel grid, press and hold the memory, and choose <strong>Edit channel</strong>. Compare both frequencies and both DCS fields with the card on page 1.</li>
<li><strong>Select the channel.</strong> Return to the grid and tap its tile. The supplied panel highlights the selected tile and shows its name and frequency at the bottom. Check the radio's display too.</li>
<li><strong>Use Single CH for this first check.</strong> In the panel's <strong>Work Mode</strong> row, select <strong>Single CH</strong>. Do not use Scan or Dual CH while learning which channel is active. Check Talk Around remains off.</li>
<li><strong>Check the radio itself.</strong> Disconnect the app, power the radio off and back on, and select the memory again. Hold <strong>*</strong> to switch between VFO/frequency and memory/channel mode; use <strong>up/down</strong> to select the saved memory.</li>
<li><strong>Have the lead verify stored settings.</strong> Reopening the phone editor alone does not prove a cached entry was written to the radio. The lead should inspect the radio's channel-list <strong>Edit</strong> view or read its stored configuration after reconnecting.</li>
</ol>

## Verify each item separately

<div class="checklist"><ul>
<li>Memory name: Heights 6 (or the lead's agreed LHH FW label)</li>
<li>RX: <strong>462.38750 MHz</strong></li>
<li>TX: <strong>467.38750 MHz</strong></li>
<li>Receive and transmit DCS: <strong>331N</strong></li>
<li>Power and bandwidth verified against the lead's plan</li>
<li>Memory remains available after restarting the radio</li>
<li>Other saved channels remain unchanged</li>
</ul></div>

## Listen before transmitting

<p>Set an audible volume and arrange a reception check with the lead. A quiet speaker may mean no one is talking; it does not prove programming failed. Keep the app's green microphone control and the radio's PTT button untouched until an authorized check is arranged.</p>

<p><strong>Phone optional:</strong> BTECH says normal RF voice operation does not require a phone or internet connection. If dual watch is later enabled, the large-font radio channel is the active main channel; holding <strong>Return</strong> changes main/sub selection.</p>

<div class="sources">Sources: supplied channel-panel captures 1–2; BTECH UV-PRO Manual, pp. 4, 7–8; BTECH product page (phone-independent operation).</div>

<!-- pagebreak -->

<p class="lede">Complete a supervised two-way check and keep a record of the result.</p>

## 6. Make an authorized radio check

<div class="warning"><strong>Transmit only when authorized.</strong> Have the radio lead confirm the equipment and operating settings are permitted for the channel. Do not test during emergency traffic.</div>

<ol class="procedure">
<li><strong>Arrange the check.</strong> Use a safe location, select Heights 6, and listen first. Follow the lead's timing and COM-002's net procedure.</li>
<li><strong>Make a short call.</strong> When authorized, press PTT, pause briefly, and say your assigned callsign and “radio check.” Release PTT to hear the reply.</li>
<li><strong>Confirm both directions.</strong> You should hear the other station clearly, and it should confirm that it heard and understood you.</li>
<li><strong>Record the result.</strong> If either direction fails, ask for help before duty. Do not change frequencies or codes at random.</li>
</ol>

## Troubleshooting

<table>
<thead><tr><th scope="col">Problem</th><th scope="col">Check next</th></tr></thead>
<tbody>
<tr><th scope="row">Phone will not connect</th><td>Radio power, Bluetooth, required permissions, pairing mode, and selected device.</td></tr>
<tr><th scope="row">Channel missing after restart</th><td>Correct group and memory mode; repeat SAVE while connected and have the lead read stored settings.</td></tr>
<tr><th scope="row">No received speech</th><td>Volume, selected memory, RX frequency, receive DCS, and known station activity.</td></tr>
<tr><th scope="row">Others cannot hear you</th><td>Stop transmitting. Ask the lead to check TX frequency/DCS, Disable TX, power, authorization, and coverage.</td></tr>
</tbody>
</table>

## Commissioning record

<p>Checked by: _______________________ &nbsp; Date: _______________<br>Receive check: __________ &nbsp; Authorized two-way check: __________<br>Bandwidth / power confirmed: __________________________________</p>

<p><strong>Before duty:</strong> charge the battery, confirm the channel, know your callsign, and protect PTT. Use <strong>COM-002</strong> for directed-net calls. For immediate danger, call 911 when available.</p>

<div class="sources">References (accessed October 9, 2026): <a href="https://baofengtech.com/wp-content/uploads/2024/08/BTECHpackaging_UVPRO_Manual_Rev3.pdf">BTECH UV-PRO Manual, Rev. 3</a>, pp. 4–8, 11–15, 22, 31; <a href="https://baofengtech.com/product/uv-pro/">BTECH UV-PRO product page</a>; COM-002; project-owner channel/gesture confirmations and supplied Android captures. Draft requires editor and subject-matter review before publication.</div>
