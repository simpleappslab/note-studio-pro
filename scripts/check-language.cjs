const assert=require('node:assert/strict');
const {performance}=require('node:perf_hooks');
const {detect,fromFilename}=require('../dist/language-detection.js');
const cases=[
 ['json','{"quoteId":"Q1","products":[{"sku":"IC.CC","quantity":2}]}'],
 ['json','[1, 2, 3]'],
 ['json','{\n  "name": "Draft",\n  "active": true,\n'],
 ['sql',"SELECT Id, Name, StockKeepingUnit FROM Product2 WHERE IsActive = true"],
 ['sql',"select name from products where quantity > 1;"],
 ['sql','DECLARE\n  n NUMBER;\nBEGIN\n  n := 1;\nEND;'],
 ['html','<!DOCTYPE html><html><body><h1>Hello</h1></body></html>'],
 ['html','<div class="greeting">Hello</div>'],
 ['xml','<?xml version="1.0"?><quote><sku>IC.CC</sku></quote>'],
 ['xml','<quote><sku>IC.CC</sku></quote>'],
 ['javascript','const total = price * quantity;'],
 ['javascript','function add(a, b) { return a + b; }\nconsole.log(add(1,2));'],
 ['typescript','interface Quote { id: string; quantity: number; }\nconst quote: Quote = {id: "Q1", quantity: 2};'],
 ['typescript','const title: string = "Hello";'],
 ['python','def add(a, b):\n    return a + b\n\nprint(add(1, 2))'],
 ['python','#!/usr/bin/env python3\nprint("hello")'],
 ['css','.card { display: flex; padding: 16px; color: green; }'],
 ['css','body { margin: 0; font-family: sans-serif; }'],
 ['yaml','name: notepad\nversion: 1.3\nfeatures:\n  - auto language'],
 ['shell','#!/bin/bash\necho "Hello"\nexport NAME=notepad'],
 ['java','public class Hello { public static void main(String[] args) { System.out.println("Hello"); } }'],
 ['java','public with sharing class QuoteAction { public static void run() { System.debug("Hello"); } }'],
 ['cpp','#include <iostream>\nint main() { std::cout << "Hello"; return 0; }'],
 ['csharp','using System;\nnamespace Demo { class App { static void Main() { Console.WriteLine("Hello"); } } }'],
 ['markdown','# My notes\n\n- first item\n- second item'],
 ['properties','[editor]\nfontSize=14\nwrap=true'],
 ['diff','--- a/file.txt\n+++ b/file.txt\n@@ -1 +1 @@\n-old\n+new\n'],
 ['text','Please create a quote for two cabinets in DX1.'],
 ['text','Hello world'],
 ['text','This is a list of things to do tomorrow.'],
 ['text','2026-11-06 INFO Request completed successfully.']
];
for(const [expected,text] of cases) assert.equal(detect(text,'untitled.txt'),expected,text);
assert.equal(detect('SELECT Id FROM Quote','notes.txt'),'sql');
assert.equal(detect('{"active":true}','playground.js'),'json');
assert.equal(detect('partial code','scratch.py'),'python');
assert.equal(detect('','file.ts'),'typescript');
assert.equal(fromFilename('ASSET.SVG'),'xml');
assert.equal(fromFilename('.bashrc'),'shell');
const start=performance.now();
assert.equal(detect('SELECT Id FROM Quote\n'+' '.repeat(5000000),'large.txt'),'sql');
assert.equal(detect('a'.repeat(5000000),'large.txt'),'text');
console.log(JSON.stringify({languageCases:cases.length+8,boundedSample:24000,largeInputMilliseconds:Math.round(performance.now()-start)}));
