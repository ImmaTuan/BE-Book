// Empty optional cells mean "leave unchanged", not "erase existing data".
export function bookImportChanges(book, data) {
  const changes=[];
  if(Number(book.price)!==Number(data.price))
    changes.push({field:"price",before:Number(book.price),after:Number(data.price)});
  if(data.publication_year!==null && data.publication_year!==undefined &&
     Number(book.publication_year??0)!==Number(data.publication_year))
    changes.push({field:"publication_year",before:book.publication_year===null?null:Number(book.publication_year),after:Number(data.publication_year)});
  if(data.cover_url && String(book.cover_url??"").trim()!==data.cover_url.trim())
    changes.push({field:"cover_url",before:book.cover_url||null,after:data.cover_url.trim()});
  return changes;
}
