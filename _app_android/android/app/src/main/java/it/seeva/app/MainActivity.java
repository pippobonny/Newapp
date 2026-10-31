package it.seeva.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // "Aggiungi al calendario" nell'app (Fil, 2026-10-31): plugin nostro,
        // va registrato prima di super.onCreate.
        registerPlugin(SeevaCalendarPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
