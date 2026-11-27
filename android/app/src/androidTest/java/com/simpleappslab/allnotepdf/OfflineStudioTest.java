package com.simpleappslab.allnotepdf;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;

import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.TimeUnit;

@RunWith(AndroidJUnit4.class)
public class OfflineStudioTest {
    private String evaluate(ActivityScenario<MainActivity> screen, String javascript) throws InterruptedException {
        ArrayBlockingQueue<String> result = new ArrayBlockingQueue<>(1);
        screen.onActivity(activity -> activity.getBridge().getWebView().evaluateJavascript(javascript, result::offer));
        String value = result.poll(5, TimeUnit.SECONDS);
        assertNotNull("The WebView did not respond", value);
        return value;
    }

    private void await(ActivityScenario<MainActivity> screen, String condition, String description) throws InterruptedException {
        long deadline = android.os.SystemClock.elapsedRealtime() + 45000;
        String value = "false";
        while (!value.equals("true") && android.os.SystemClock.elapsedRealtime() < deadline) {
            value = evaluate(screen, "Boolean(" + condition + ")");
            if (!value.equals("true")) Thread.sleep(250);
        }
        String diagnostic = value.equals("true") ? "" : evaluate(screen, """
            JSON.stringify({url:location.href, title:document.title,
              studio:document.querySelector('#pdf-app')?.getAttribute('aria-busy'),
              bridge:typeof window.Capacitor, exportBridge:typeof window.AllNoteNativeFiles,
              status:document.querySelector('#status')?.textContent})
            """);
        assertEquals(description + " " + diagnostic, "true", value);
    }

    @Test
    public void opensAndRecognizesAPdfWithNetworkDisabled() throws InterruptedException {
        try (ActivityScenario<MainActivity> screen = ActivityScenario.launch(MainActivity.class)) {
            await(screen, "window.AllNoteNativeFiles && document.querySelector('#pdf-app[aria-busy=false]')",
                "The bundled editor and native file bridge should load");
            evaluate(screen, """
                void (async () => {
                  const canvas = document.createElement('canvas');
                  canvas.width = 640;
                  canvas.height = 220;
                  const ctx = canvas.getContext('2d');
                  ctx.fillStyle = 'white';
                  ctx.fillRect(0, 0, 640, 220);
                  ctx.fillStyle = 'black';
                  ctx.font = '50px sans-serif';
                  ctx.fillText('ALLNOTE OFFLINE OCR', 28, 110);
                  const pdf = await PDFLib.PDFDocument.create();
                  const image = await pdf.embedPng(canvas.toDataURL());
                  pdf.addPage([640, 220]).drawImage(image, {x:0,y:0,width:640,height:220});
                  const input = new DataTransfer();
                  input.items.add(new File([await pdf.save()], 'offline-scan.pdf', {type:'application/pdf'}));
                  document.querySelector('#paper').dispatchEvent(new DragEvent('drop', {dataTransfer:input}));
                })();
                """);
            await(screen, "document.querySelector('#position')?.textContent === '1 / 1'",
                "The PDF should render from local bytes");
            evaluate(screen, "document.querySelector('[data-op=ocr]').click()");
            await(screen, "document.querySelector('#status')?.textContent.includes('Recognized 1 scanned page')",
                "The packaged OCR worker and model should work offline");
        }
    }
}
