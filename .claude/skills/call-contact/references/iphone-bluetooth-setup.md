# Setting up an iPhone for calls from a Windows PC

A `tel:` link places the call through the iPhone only when three things are true:

1. The iPhone is linked to the PC through **Phone Link** (the Windows app) and **Link to Windows** (the iPhone app).
2. Windows sends `tel:` links to Phone Link.
3. The iPhone's Bluetooth settings for the PC allow notifications and contacts.

The practitioner does every step on the phone and every click on the PC. You direct, check state and explain. Give one step at a time and wait for their result. Never read, copy or report the iPhone's contacts, messages or call history.

## Check first

Run these in PowerShell on the PC (from a Bash tool, wrap each in `powershell.exe -NoProfile -Command "..."`). If you can't reach the PC's own shell, which is the case in a Cowork sandbox, ask the practitioner to paste them into PowerShell and send you the output. None of them changes anything.

```powershell
Get-PnpDevice | Where-Object FriendlyName -match 'iPhone' | Select-Object Status, Class, FriendlyName
Get-Process PhoneExperienceHost -ErrorAction SilentlyContinue
(Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\Shell\Associations\UrlAssociations\tel\UserChoice' -ErrorAction SilentlyContinue).ProgId
```

- **Linked and working:** the iPhone is listed with status `OK`, including a `Hands-Free HF` entry, and `PhoneExperienceHost` is running. Skip to "Route `tel:` links".
- **Nothing listed, or pairing has already failed:** start with "Clean pairing".
- **The third command** names the app that opens `tel:` links. Phone Link's is `AppX8zw7xct41bx2wrswqekb78rm243h02yh`. Anything else, such as Webex or another calling app, means `tel:` links won't use the iPhone. Go to "Route `tel:` links".

## Clean pairing

The failure seen so far: the iPhone shows "Unable to complete Bluetooth pairing", Windows shows the iPhone flickering between Connected and Not connected, and the Bluetooth event logs stay empty. The cause was **old pairing records on both devices**. Reinstalling apps, restarting and resetting Phone Link did not fix it. Clearing the old records did.

1. **PC, clear the old records.** In **Settings > Bluetooth & devices**, remove every entry for the iPhone. If Windows says "Remove failed", find the leftover entries:

   ```powershell
   Get-PnpDevice | Where-Object FriendlyName -match 'iPhone' | Select-Object Status, InstanceId
   ```

   Then have the practitioner open **PowerShell as administrator** and remove each `BTHLE\...` or `BTHENUM\DEV_...` entry:

   ```powershell
   pnputil /remove-device "<InstanceId>"
   ```

   Removing an entry needs administrator rights, and a normal session gets `Access is denied.` Once that has run, Settings' own **Remove** also works. Repeat the first command until it returns nothing.
2. **iPhone, clear the old records.** Go to **Settings > Bluetooth** and find the PC's name wherever it appears. Tap **(i) > Forget This Device**.
3. **iPhone:** install **Link to Windows** from the App Store. If it is already installed and pairing has failed, uninstall it from the iPhone and install it again, which clears its data. Then swipe it closed in the app switcher.
4. **PC:** open **Settings > Bluetooth & devices** and leave it open, which keeps the PC discoverable. Then go to **Mobile devices > Add device > iPhone®**. Sign in with the practitioner's personal Microsoft account, not a work account.
5. **iPhone:** open **Link to Windows** and scan the QR code. When a **Pair** prompt appears, check that the 6-digit code is the same on both screens, then accept it on both within about 30 seconds. Allow the permissions it asks for, including file sharing.
6. **Check:** run the first command in "Check first" again. Expect several `OK` entries, including `Hands-Free HF` and `Hands-Free HF Audio`.
7. **iPhone:** go to **Settings > Bluetooth > (i)** next to the PC and turn on **Show Notifications**, **Sync Contacts** and **Share System Notifications**.

**Dead ends. Don't repeat them:** the "Continue manually without a QR code" route (`aka.ms/startLinking`) fails in the same way. Pairing the iPhone in Windows Settings first does not help, because Link to Windows runs its own pairing. Wait at least a minute on "Looking for your PC" before calling an attempt failed.

## Linked, but calls fail

Phone Link shows **Connected** and syncs notifications, but its Calls tab says "We weren't able to connect to your mobile device". In the first command's output, the two `Hands-Free HF Audio` `AudioEndpoint` entries show `Unknown` while the rest show `OK`. That means the call-audio connection is down while the pairing is intact.

Fix, confirmed 2026-09-29: have the practitioner turn Bluetooth off and on, first on the iPhone in **Settings > Bluetooth** (not Control Center, which leaves the radio on), then on the PC in **Settings > Bluetooth & devices**. Then they click **Try again** in Phone Link. Run the first command again: both `AudioEndpoint` entries should now be `OK`.

## Route `tel:` links to Phone Link

Phone Link registers for `tel:` links, and so does Webex. Windows sends them to whichever app is chosen as the default, and it must be Phone Link: Webex has its own `webextel:` links (see "Webex fallback" in `SKILL.md`).

To switch, have the practitioner go to **Settings > Apps > Default apps > Choose defaults by link type**, find **TEL** and pick **Phone Link**. Confirm with the third command in "Check first".

## Test

The practitioner places one call to a number they choose and confirms they can hear and be heard. You never choose the number or dial it.
