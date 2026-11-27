import UIKit
import Capacitor
import EventKit
import EventKitUI

/* "Aggiungi al calendario" nell'app iPhone (Fil, 2026-11-27): apre
   direttamente la schermata "Nuovo evento" del Calendario di iOS, gia'
   compilata; la persona tocca solo "Aggiungi". Stessa interfaccia del
   plugin Android (SeevaCalendar.addEvent: title, description, location,
   begin, end in millisecondi, allDay). Da iOS 17 l'editor di sistema non
   chiede nessun permesso; su iOS 15-16 si chiede il permesso una volta. */
@objc(SeevaCalendarPlugin)
public class SeevaCalendarPlugin: CAPPlugin, CAPBridgedPlugin, EKEventEditViewDelegate {
    public let identifier = "SeevaCalendarPlugin"
    public let jsName = "SeevaCalendar"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "addEvent", returnType: CAPPluginReturnPromise)
    ]

    private let store = EKEventStore()
    private var pendingCall: CAPPluginCall?

    @objc func addEvent(_ call: CAPPluginCall) {
        guard let begin = call.getDouble("begin"), let end = call.getDouble("end") else {
            call.reject("Data mancante")
            return
        }
        let allDay = call.getBool("allDay") ?? false
        let title = call.getString("title") ?? ""
        let notes = call.getString("description") ?? ""
        let location = call.getString("location") ?? ""

        DispatchQueue.main.async {
            if #available(iOS 17.0, *) {
                self.present(call, begin, end, allDay, title, notes, location)
            } else {
                self.store.requestAccess(to: .event) { granted, _ in
                    DispatchQueue.main.async {
                        if granted {
                            self.present(call, begin, end, allDay, title, notes, location)
                        } else {
                            call.reject("Permesso calendario negato")
                        }
                    }
                }
            }
        }
    }

    private func present(_ call: CAPPluginCall, _ begin: Double, _ end: Double, _ allDay: Bool,
                         _ title: String, _ notes: String, _ location: String) {
        guard let vc = self.bridge?.viewController else {
            call.reject("Schermata non disponibile")
            return
        }
        let event = EKEvent(eventStore: store)
        event.title = title
        event.notes = notes
        if !location.isEmpty { event.location = location }
        event.isAllDay = allDay
        if allDay {
            // Dal JS arriva la mezzanotte UTC del giorno: la rimetto a mezzanotte locale.
            var utc = Calendar(identifier: .gregorian)
            utc.timeZone = TimeZone(identifier: "UTC")!
            let c = utc.dateComponents([.year, .month, .day], from: Date(timeIntervalSince1970: begin / 1000))
            let local = Calendar.current
            let start = local.date(from: c) ?? Date(timeIntervalSince1970: begin / 1000)
            event.startDate = start
            event.endDate = start
        } else {
            event.startDate = Date(timeIntervalSince1970: begin / 1000)
            event.endDate = Date(timeIntervalSince1970: end / 1000)
        }
        event.calendar = store.defaultCalendarForNewEvents

        let editor = EKEventEditViewController()
        editor.eventStore = store
        editor.event = event
        editor.editViewDelegate = self
        pendingCall = call
        vc.present(editor, animated: true)
    }

    public func eventEditViewController(_ controller: EKEventEditViewController,
                                        didCompleteWith action: EKEventEditViewAction) {
        controller.dismiss(animated: true) {
            self.pendingCall?.resolve(["saved": action == .saved])
            self.pendingCall = nil
        }
    }
}

/* Schermata principale dell'app: uguale a quella di Capacitor, ma registra
   anche il plugin del calendario (plugin locali, non da npm). */
class SeevaBridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(SeevaCalendarPlugin())
    }
}
