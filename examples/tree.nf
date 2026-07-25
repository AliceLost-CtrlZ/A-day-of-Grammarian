// A binary search tree, polymorphic in whatever it stores.

type 'a tree =
  | Leaf
  | Node of 'a tree * 'a * 'a tree

let rec insert value tree =
  match tree with
  | Leaf -> Node (Leaf, value, Leaf)
  | Node (left, current, right) ->
    if value < current then Node (insert value left, current, right)
    else if value > current then Node (left, current, insert value right)
    else tree

let of_list xs = fold_left (flip insert) Leaf xs

let rec to_list tree =
  match tree with
  | Leaf -> []
  | Node (left, value, right) -> to_list left @ [value] @ to_list right

let rec depth tree =
  match tree with
  | Leaf -> 0
  | Node (left, _, right) -> 1 + max (depth left) (depth right)

let rec contains value tree =
  match tree with
  | Leaf -> false
  | Node (left, current, right) ->
    if value = current then true
    else if value < current then contains value left
    else contains value right

let numbers = of_list [8; 3; 10; 1; 6; 14; 4; 7; 13]

do println ("in order: " ^ show (to_list numbers))
do println ("depth:    " ^ string_of_int (depth numbers))
do println ("has 6:    " ^ show (contains 6 numbers))
do println ("has 5:    " ^ show (contains 5 numbers))

// The very same tree works for strings, because `insert` is polymorphic:
//   val insert : 'a -> 'a tree -> 'a tree
let names = of_list ["pear"; "apple"; "fig"; "quince"; "date"]

do println ("names:    " ^ show (to_list names))
