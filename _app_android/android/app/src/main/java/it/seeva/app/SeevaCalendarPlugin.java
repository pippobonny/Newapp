package it.seeva.app;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.provider.CalendarContract;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/* "Aggiungi al calendario" nell'app Android (Fil, 2026-10-31: "da seeva
   app apk non potevo aggiungere al calendario"). Nella WebView il download
   del file .ics non fa niente, quindi si apre direttamente la schermata
   "nuovo evento" dell'app calendario del telefono (Google Calendar,
   Samsung Calendar...), già compilata: la persona tocca solo "Salva".
   Non servono permessi: è il calendario a salvare, non seeva. */
@CapacitorPlugin(name = "SeevaCalendar")
public class SeevaCalendarPlugin extends Plugin {

    @PluginMethod
    public void addEvent(PluginCall call) {
        Long begin = call.getLong("begin");
        Long end = call.getLong("end");
        if (begin == null || end == null) {
            call.reject("Data mancante");
            return;
        }
        Intent intent = new Intent(Intent.ACTION_INSERT)
            .setData(CalendarContract.Events.CONTENT_URI)
            .putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, begin.longValue())
            .putExtra(CalendarContract.EXTRA_EVENT_END_TIME, end.longValue())
            .putExtra(CalendarContract.EXTRA_EVENT_ALL_DAY, call.getBoolean("allDay", false).booleanValue())
            .putExtra(CalendarContract.Events.TITLE, call.getString("title", ""))
            .putExtra(CalendarContract.Events.DESCRIPTION, call.getString("description", ""))
            .putExtra(CalendarContract.Events.EVENT_LOCATION, call.getString("location", ""));
        try {
            getActivity().startActivity(intent);
            call.resolve();
        } catch (ActivityNotFoundException e) {
            call.reject("Nessuna app calendario sul telefono");
        }
    }
}
