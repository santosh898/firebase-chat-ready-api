const firebaseApp = require('firebase/app');
require('firebase/firestore');
const initializeApp = firebaseApp.initializeApp;
const firebase = firebaseApp.firestore;
const _ = require("lodash")

// add new errors references
class ChatRoomError extends Error { }
class InitializeAppError extends Error { }
class MessageError extends Error { }

/**
 * initialize Firebase connection and configuration 
 * @param {Object} configures your config object 
 */
function initializeFirebase(configures) {
    // set configurations 
    if (!_.isObjectLike(configures))
        throw new InitializeAppError("The configures must be an object")

    if (_.isEmpty(configures))
        throw new InitializeAppError("The configures shouldn't be empty")

    // Initialize Firebase
    initializeApp(configures);
}

function createChatRoom(title, members) {
    if (_.isEmpty(title) || !_.isString(title))
        throw new ChatRoomError("title should be not empty and be string");
    members.forEach(member => {
        if (_.isEmpty(member.userId) || !_.isString(member.userId))
            throw new ChatRoomError('Users must be a string and not empty ,your Object keys must be  {userId, username if any, photo if any} ');

        if ((member.username && !_.isString(member.username)))
            throw new ChatRoomError("User names should be strings");

        if ((member.photo && !_.isString(member.photo)))
            throw new ChatRoomError("Photos should be strings");
        member.username = member.username || '';
        member.phtot = member.photo || '';
    })
    const chatRoomRef = firebase().collection('ChatRooms').doc();
    const createdAt = Date.now();
    chatRoomRef.set({
        title: title,
        members: members,
        createdAt,
        isRemoved: false,
        isOpen: true
    }).then(() => {
        members.forEach(member => { addToMemberConversations(member.userId, chatRoomRef.id); });
        return new ChatRoom(title, members, chatRoomRef);
    });
}

function addToMemberConversations(memberId, chatKey) {
    const chatRef = firebase().collection("UsersChat").doc(memberId);
    chatRef.get().then((snap) => {
        if (snap.exists) {
            chatRef.update({ [chatKey]: chatKey }).catch((err) => {
                if (err) {
                    throw new ChatRoomError(err)
                }
            });
        }
        else {
            chatRef.set({ [chatKey]: chatKey }).catch((err) => {
                if (err) {
                    throw new ChatRoomError(err)
                }
            });
        }
    })
}

function joinChatRoom(member) {
    const chatRoomRef = firebase().collection('ChatRooms').doc(member.id);
    return chatRoomRef.get().then((doc) => {
        if (!doc.exists) {
            throw new ChatRoomError("Chat Room does'nt exist");
        }
        const room = doc.data();
        if (room.isRemoved) {
            throw new ChatRoomError("Chat Room was Already removed");
        }
        if (!room.isOpen) {
            throw new ChatRoomError("Chat Room is Private");
        }
        room.members.push(member);
        room.isOpen = false;
        return chatRoomRef.update({ members: room.members, isOpen: false })
            .then(() => {
                addToMemberConversations(member.userId, chatRoomRef.id);
                return new ChatRoom(chatRoomRef, room);
            });
    })
}
/**@class */
class ChatRoom {

    /**
     * create chat room between two users .
     * @constructor
     * @param {String} title  the title of this chat room.
     * @param {[{userId:String, username:String, photo:String}]} members userId , username and photo of the users in this chat room.
     * @param {null} fromRef shouldn't be calld at all
     * @returns {ChatRoom} object contains all chat room properties  
     */
    constructor(fromRef, title, members, createdAt) {
        this.title = title
        this.members = members;
        this.createdAt = createdAt;
        this.isRemoved = false;
        this.chatRoomRef = fromRef;
        this.isOpen = true;
    }

    constructor(fromRef, room) {
        this.title = room.title;
        this.members = room.members;
        this.isRemoved = room.isRemoved;
        this.createdAt = room.createdAt;
        this.isOpen = room.isOpen;
        this.chatRoomRef = fromRef;
    }

    /**
     * change the title of the chat room 
     * @param {String} title  the new title to be changed 
     * @param {(title:String)=>void} [onComplete] Callback function call after changing chat room title or with err if not
     */
    setNewTitle(title, onComplete) {
        // validate title
        if (!_.isString(title) || _.isEmpty(title)) {
            throw new ChatRoomError("title should be not empty and string")
        }
        // update chat room title
        this.chatRoomRef.update({
            title,
        }).then(onComplete(title));
    }

    /**
     * remove chat room 
     * @param {Boolean} softRemove  set falg to chat room to marked it as removed 
     * @param {(err:Error)=>void}  [onComplete] Callback function call after remove
     */
    remove(softRemove = false, onComplete) {
        if (softRemove) {
            // update chat room isRemoved flag
            this.chatRoomRef.update({
                isRemoved: true,
            }).then(onComplete);
            return this;
        }
        this.chatRoomRef.remove(onComplete);
        return this;
    }
    /**
     * remove mutual chat rooms  between two users
     * @param {String} userA  set falg to chat room to marked it as removed 
     * @param {String} userB  set falg to chat room to marked it as removed 
     * @param {Boolean} softRemove  set falg to chat room to marked it as removed 
     * @param {(err:Error)=>void}  [onComplete] Callback function call after remove
     */
    static async removeMutualChatRooms(userA, userB, softRemove = false) {
        // get user A chat keys
        var userARef = await firebase().collection("UsersChat").doc(userA).get();
        var userBRef = await firebase().collection("UsersChat").doc(userB).get();
        const userAChats = Object.keys(userARef.data());
        Object.keys(userBRef.data()).forEach(id => {
            var chatRoomRef = firebase().collection("ChatRooms").doc(id)
            if (userAChats.includes(id)) {
                if (softRemove) {
                    // update chat room isRemoved flag
                    chatRoomRef.update({
                        isRemoved: true,
                    });
                } else chatRoomRef.remove();
            }
        })
    }

    /**
     * send message in this chat room 
     * @param  {String} body the message body (message it self)
     * @param  {String} from the id of the user sent this message
     * @param {(err:Error)=>void}  [onComplete] Callback function call after changing chat room title or with err if not     * 
     * @returns {Message} Message that has been sent 
     * 
     */
    sendMessage(body, from, onComplete) {
        return new Message(body, from, this, onComplete);
    }

    /**
     * get all user chat rooms with his _id
     * @param {String|{userId:String}} user
     * @param {(err:Error,chats:ChatRoom[])=>void} onComplete Callback function call after receiving the chat rooms  or with err if not
     */
    static getUserChatRooms(user, onComplete) {
        // check validation of the user id string
        if (_.isEmpty(user))
            throw new ChatRoomError("userId should be string")

        if (_.isObject(user)) {
            user = user.userId;
        }
        var userChatRoomsRef = firebase().collection("UsersChat").doc(user);

        // check if the user exist and get Chatrooms
        userChatRoomsRef.get().then((doc) => {
            if (!doc.exists)
                return onComplete("User has no chat rooms", undefined)
            else {
                var list = []
                const data = doc.data();
                const ids = Object.keys(data);
                ids.forEach((id) => {
                    const chatRoomRef = firebase().collection('ChatRooms').doc(id);
                    chatRoomRef.get().then((doc) => {
                        if (!doc.exists) {
                            return;
                        }
                        const snap = doc.data();
                        const userAFire = {
                            userId: snap.members[0].userId,
                            username: snap.members[0].username,
                            photo: snap.members[0].photo
                        };
                        const userBFire = {
                            userId: snap.members[1].userId,
                            username: snap.members[1].username,
                            photo: snap.members[1].photo
                        }
                        const newChat = new ChatRoom(snap.title, userAFire, userBFire, undefined, chatRoomRef);
                        newChat.createdAt = snap.createdAt;
                        list.push(newChat);
                        if (list.length == ids.length) {
                            // passing list if all user chatrooms ChatRoom instance 
                            onComplete(undefined, list)
                        }
                    });
                });
            }
        });
    }

    // TODO: should remove this function as it redundant to getMessagesAndListen
    /**
     * Edit you should not use this function instead use getMessagesAndListen
     * get all the messages related to this chat room
     * get message by message
     * 
     * @param {Function} onComplete callback after receive each message
     */
    getAllMessages(onComplete) {
        // ! remove this error to make it work
        throw new ChatRoomError("You should not use this method use getMessagesAndListen instead ");

        // ?  working ? 
        this.chatRoomRef.child("messages").once("value", (messagesSnapshot) => {
            messagesSnapshot.forEach((message) => {
                var messageRef = this.chatRoomRef.child("messages").child(message.key);
                var message = message.toJSON()
                var newMessage = new Message(message.body, message.from, this, undefined, messageRef)
                onComplete(undefined, newMessage)
            })
        }, onComplete)
    }

    /**
     * get all messages and listen to new messages 
     * make an action when received a new mesage
     * @param {(newMessage:Message)=>void} action that should happen when receiving this message
     */
    getMessagesAndListen(action) {
        this.chatRoomRef.collection("messages").onSnapshot((snapshot) => {
            snapshot.docChanges().forEach((change) => {
                if (change.type === 'added') {
                    const doc = change.doc;
                    var messageRef = this.chatRoomRef.collection("messages").doc(doc.id);
                    var message = doc.data();
                    var newMessage = new Message(message.body, message.from, this, undefined, messageRef);
                    newMessage.createdAt = message.createdAt;
                    action(newMessage);
                }
            });
        })
    }

    /**
     * get chat by firebase uid  
     * @param {String} uid chat unique id
     * @param {(err:Error,chatroom:ChatRoom)=>void} onSuccess Callback function call after receiving the chat room  or with err if not
     */
    static findById(uid, onSuccess) {
        var chat = firebase().collection("ChatRooms").doc(uid);
        chat.get().then((doc) => {
            if (!doc.exists) {
                return onSuccess('doc does not exist', undefined);
            }
            else {
                const snap = doc.data();
                if (snap === null) {
                    return onSuccess("Chat not found!", undefined);
                }
                const userAFire = {
                    userId: snap.members[0].userId,
                    username: snap.members[0].username,
                    photo: snap.members[0].photo
                }
                const userBFire = {
                    userId: snap.members[1].userId,
                    username: snap.members[1].username,
                    photo: snap.members[1].photo
                }
                var newChat = new ChatRoom(snap.title, userAFire, userBFire, undefined, chat)
                return onSuccess(undefined, newChat);
            }
        });
    }

}

/**  @class */
class Message {
    /**
     * @constructor
     * @param {String} body String: the message body (message it self)
     * @param {String|{userId:String}} from String: the id of the user sent this message
     * @param  {ChatRoom} chatRoom ChatRoom: refrance to the chat room this message in
     * @param {(err:Error)=>void} [onComplete] Callback function call after changing chat room title or with err if not     * 
     * @returns {Message} Message that has been created 
     * 
     */
    constructor(body, from, chatRoom, onComplete, fromRef) {
        // check validation message body
        if (_.isEmpty(body) || !_.isString(body))
            throw new MessageError("Message should have body and be string")
        this.body = body

        // check validation of the user id string
        if (_.isEmpty(from))
            throw new MessageError("From should be not empty")

        // check if the user in this chat room 
        if ((_.isString(from) && chatRoom.members[0].userId !== from) && (_.isString(from) && chatRoom.members[1].userId !== from))
            throw new MessageError(" 'from' user must be in this chat room")

        // check if the user in this chat room 
        if ((_.isObject(from) && chatRoom.members[0].userId !== from.userId) && (_.isObject(from) && chatRoom.members[1].userId !== from.userId))
            throw new MessageError(" 'from' user must be in this chat room")

        if (_.isString(from)) {
            this.from = from;
        } else {
            this.from = from.userId;
        }

        if (!chatRoom instanceof ChatRoom)
            throw new MessageError("chatRoom should be instance of ChatRoom class")

        this.chatRoom = chatRoom;
        this.createdAt = Date.now()

        if (_.isEmpty(fromRef)) {
            this.messageRef = chatRoom.chatRoomRef.collection("messages").doc();
            this.messageRef.set({
                body: this.body,
                from: this.from,
                createdAt: this.createdAt,
            }).then(onComplete);
        } else {
            this.messageRef = fromRef
        }
    }

    /**
     * update message
     * @param {String} newBody new message body for this message 
     * @param  {(newBody:String)=>void} [callback] action after update 
     * 
     */
    updateBody(newBody, callback) {
        // check validation message body
        if (_.isEmpty(newBody) || !_.isString(newBody))
            throw new MessageError("Message should have body and be string")

        this.updatedAt = Date.now()
        // update chat room title
        this.messageRef.update({
            body: newBody,
            updatedAt: Date.now()
        }).then(callback(newBody));
    }

    /**
     * remove message
     * @param {(err:Error)=>void)} [afterRemove] action after remove the message
     * @returns {Message} Message object 
     */
    remove(afterRemove) {
        this.messageRef.remove(afterRemove);
        return this;
    }

}


module.exports = {
    initializeFirebase,
    createChatRoom,
    joinChatRoom,
    Message
}