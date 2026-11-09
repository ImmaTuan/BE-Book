import test from "node:test";
import assert from "node:assert/strict";
import { bookImportChanges } from "../src/book-import-changes.js";
const book={price:50000,publication_year:2020,cover_url:"https://example.com/old.jpg"};
test("book imports list only changed price, year and cover and allow a zero price",()=>{
  assert.deepEqual(bookImportChanges(book,{price:0,publication_year:2025,cover_url:"https://example.com/new.jpg",description:"Ignored",weight_grams:999}),[
    {field:"price",before:50000,after:0},
    {field:"publication_year",before:2020,after:2025},
    {field:"cover_url",before:"https://example.com/old.jpg",after:"https://example.com/new.jpg"},
  ]);
});
test("blank optional cells preserve metadata and unchanged values do not produce writes",()=>{
  assert.deepEqual(bookImportChanges(book,{price:50000,publication_year:null,cover_url:null}),[]);
  assert.deepEqual(bookImportChanges(book,{price:50000,publication_year:2020,cover_url:book.cover_url}),[]);
  assert.deepEqual(bookImportChanges({...book,publication_year:null,cover_url:null},{price:50000,publication_year:2025,cover_url:"https://example.com/new.jpg"}),[
    {field:"publication_year",before:null,after:2025},
    {field:"cover_url",before:null,after:"https://example.com/new.jpg"},
  ]);
});
