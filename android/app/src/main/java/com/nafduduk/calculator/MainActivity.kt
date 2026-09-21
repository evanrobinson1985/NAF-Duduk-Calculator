package com.nafduduk.calculator

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.nafduduk.calculator.library.LibraryItem
import com.nafduduk.calculator.library.LibraryScreen
import com.nafduduk.calculator.ui.AppTabBar
import com.nafduduk.calculator.ui.AppTab
import com.nafduduk.calculator.ui.duduk.DudukScreen
import com.nafduduk.calculator.ui.flute.FluteScreen
import com.nafduduk.calculator.ui.theme.Bg0
import com.nafduduk.calculator.ui.theme.NafDudukTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            NafDudukTheme {
                Surface(modifier = Modifier.fillMaxSize(), color = Bg0) {
                    AppRoot()
                }
            }
        }
    }
}

// Mirrors App() in the web source: a fixed page tab bar (Flute / Duduk /
// Library / G-Code / Flow Studio) over one of five page bodies. Each screen
// is expected to keep its own state alive the same way the web pages do
// (rememberSaveable / a hoisted ViewModel), not by relying on this composable
// to keep them mounted — Compose already skips recomposition of the hidden
// branches' state holders as long as they're kept in rememberSaveable.
@Composable
fun AppRoot() {
    var tab by rememberSaveable { mutableStateOf(AppTab.Flute) }
    // Mirrors App()'s pendingLoad: set by the Library tab's "Open" action,
    // consumed (and cleared) by the target screen's onConfigLoaded callback.
    var pendingLoad by remember { mutableStateOf<LibraryItem?>(null) }

    Column(modifier = Modifier.fillMaxSize()) {
        AppTabBar(current = tab, onSelect = { tab = it })
        Box(modifier = Modifier.fillMaxSize().background(Bg0)) {
            when (tab) {
                AppTab.Flute -> FluteScreen(
                    loadConfigJson = pendingLoad?.takeIf { it.kind == "flute" }?.configJson,
                    onConfigLoaded = { pendingLoad = null },
                )
                AppTab.Duduk -> DudukScreen(
                    loadConfigJson = pendingLoad?.takeIf { it.kind == "duduk" }?.configJson,
                    onConfigLoaded = { pendingLoad = null },
                )
                AppTab.Library -> LibraryScreen(
                    onLoad = { item ->
                        pendingLoad = item
                        tab = if (item.kind == "duduk") AppTab.Duduk else AppTab.Flute
                    },
                )
                AppTab.GCode -> PlaceholderPage("G-Code Viewer — coming soon")
                AppTab.FlowStudio -> PlaceholderPage("Flow Studio — coming soon")
            }
        }
    }
}

@Composable
private fun PlaceholderPage(label: String) {
    Column(modifier = Modifier.fillMaxWidth().padding(24.dp)) {
        Text(text = label, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
    }
}
