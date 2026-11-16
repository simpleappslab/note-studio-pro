(function(){
  'use strict';
  window.createNotepadTranspose=function({getText,copyText,openDocument}){
    const $=id=>document.getElementById(id),dialog=$('transpose-dialog');
    let result=null,opener=null;
    function invalidate(){
      result=null;$('transpose-output').value='';$('transpose-table').replaceChildren();
      $('transpose-copy').disabled=true;$('transpose-tab').disabled=true;
      $('transpose-error').hidden=true;
      $('transpose-status').textContent='Choose formats, then select Transpose. Source document stays unchanged.';
    }
    function run(){
      invalidate();
      try{
        result=NotepadTranspose.transpose($('transpose-input').value,$('transpose-format').value,$('transpose-target').value);
        $('transpose-output').value=result.text;
        $('transpose-copy').disabled=false;$('transpose-tab').disabled=false;
        $('transpose-status').textContent=result.rows+' rows × '+result.columns+' columns → '+result.columns+' rows × '+result.rows+' columns ('+result.inputFormat.toUpperCase()+' → '+result.format.toUpperCase()+').'+(result.ragged?' Missing cells padded with '+(result.inputFormat==='json'?'null.':'empty strings.'):'');
        if(result.protectedCells)$('transpose-status').textContent+=' '+result.protectedCells+' formula-like cells prefixed with an apostrophe for spreadsheet safety; JSON output preserves exact values.';
        const caption=document.createElement('caption');caption.textContent='Result preview · first 20 rows and 12 columns';$('transpose-table').append(caption);
        const body=document.createElement('tbody');
        for(const row of result.preview){
          const tr=document.createElement('tr');
          for(const value of row){const td=document.createElement('td');td.textContent=value;tr.append(td);}
          body.append(tr);
        }
        $('transpose-table').append(body);
      }catch(error){$('transpose-error').textContent=error.message;$('transpose-error').hidden=false;}
    }
    function open(){
      opener=document.activeElement;
      $('transpose-input').value=getText();
      $('transpose-format').value='auto';$('transpose-target').value='same';
      if(!dialog.open)dialog.showModal();
      run();
    }
    $('transpose-input').addEventListener('input',invalidate);
    for(const id of ['transpose-format','transpose-target'])$(id).addEventListener('change',invalidate);
    $('transpose-run').addEventListener('click',run);
    $('transpose-close').addEventListener('click',()=>dialog.close());
    $('transpose-copy').addEventListener('click',async()=>{
      if(!result)return;
      try{await copyText(result.text,dialog);$('transpose-status').textContent='Complete transposed output copied.';}
      catch{$('transpose-status').textContent='Clipboard unavailable. Select the output and copy it manually.';}
    });
    $('transpose-tab').addEventListener('click',()=>{
      if(result&&openDocument(result.text,'transposed.'+result.format,result.format==='json'?'json':'text'))dialog.close();
    });
    dialog.addEventListener('close',()=>{if(opener?.isConnected)opener.focus();});
    return {open};
  };
})();
